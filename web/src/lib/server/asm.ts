// Assembling and disassembling for the patch editor.
//
// Ghidra gives us a listing, not an assembler: nothing in ghidra-rest turns
// `xor eax, eax` into bytes, and nothing turns bytes the user typed back into
// instructions. Keystone and Capstone do both, and their WASM builds run in
// this same Node process -- no extra service, no round trip past guttex.
//
// They are loaded through `createRequire` because both ship as CommonJS with a
// sibling `.wasm`: Emscripten finds that file relative to its own script, so
// letting Node resolve the package out of node_modules is what keeps the wasm
// findable. They are also loaded lazily -- 7MB of wasm should not be paid for
// by a session that never patches anything.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** What to assemble *for*. `language` is Ghidra's id, which says all of it. */
export type Arch = {
	language?: string;
	processor?: string;
	bits?: number;
	endian?: 'little' | 'big';
	/** ARM only: assemble Thumb rather than A32 */
	thumb?: boolean;
};

/** Something the user can fix: a bad mnemonic, an architecture we cannot do. */
export class AsmError extends Error {}

export type Line = { addr: string; text: string; size: number };

type Mod = Record<string, unknown>;

type KsHandle = {
	option(option: number, value: number): void;
	asm(code: string, address?: number): { mc: Uint8Array; count: number; failed: boolean };
	errno(): number;
	close(): void;
};

type KsMod = Mod & {
	Keystone: new (arch: number, mode: number) => KsHandle;
	strerror(code: number): string;
};

type CsInstruction = {
	address: number | bigint;
	size: number;
	mnemonic: string;
	op_str: string;
	bytes: number[] | Uint8Array;
};

type CsHandle = {
	disasm(buffer: number[] | Uint8Array, address: number): CsInstruction[];
	close(): void;
};

type CsMod = Mod & {
	Capstone: new (arch: number, mode: number) => CsHandle;
};

let ksLoad: Promise<KsMod> | null = null;
let csLoad: Promise<CsMod> | null = null;

function keystone(): Promise<KsMod> {
	return (ksLoad ??= (require('@alexaltea/keystone-js') as () => Promise<KsMod>)());
}

function capstone(): Promise<CsMod> {
	return (csLoad ??= (require('@alexaltea/capstone-js') as () => Promise<CsMod>)());
}

/** First of `names` the module actually defines. Builds differ per release. */
function konst(m: Mod, ...names: string[]): number | undefined {
	for (const n of names) {
		const v = m[n];
		if (typeof v === 'number') return v;
	}
	return undefined;
}

function need(m: Mod, what: string, ...names: string[]): number {
	const v = konst(m, ...names);
	if (v === undefined) throw new AsmError(`this build has no ${what}`);
	return v;
}

/**
 * Ghidra's language id is `processor:endian:size:variant` -- `x86:LE:64:default`
 * -- which is everything the engines need in one string. The separate fields
 * are the fallback for an analysis that did not record it.
 */
export function readArch(a: Arch): Required<Pick<Arch, 'processor' | 'bits' | 'endian'>> & {
	thumb: boolean;
} {
	let processor = a.processor ?? '';
	let bits = a.bits ?? 0;
	let endian = a.endian;
	const parts = (a.language ?? '').split(':');
	if (parts.length >= 3) {
		processor = parts[0] || processor;
		endian = parts[1]?.toUpperCase() === 'BE' ? 'big' : 'little';
		bits = Number(parts[2]) || bits;
	}
	return {
		processor: processor.toLowerCase() || 'x86',
		bits: bits || 32,
		endian: endian ?? 'little',
		thumb: a.thumb ?? false
	};
}

function ksTarget(m: KsMod, a: Arch): { arch: number; mode: number } {
	const { processor, bits, endian, thumb } = readArch(a);
	const big = endian === 'big';
	const end = big
		? need(m, 'big-endian mode', 'MODE_BIG_ENDIAN')
		: konst(m, 'MODE_LITTLE_ENDIAN') ?? 0;

	switch (processor) {
		case 'x86':
			if (big) throw new AsmError('x86 is little-endian only');
			return {
				arch: need(m, 'x86 support', 'ARCH_X86'),
				mode: need(m, `${bits}-bit mode`, `MODE_${bits}`)
			};
		case 'aarch64':
		case 'arm64':
			return { arch: need(m, 'arm64 support', 'ARCH_ARM64'), mode: end };
		case 'arm':
			if (bits === 64) return { arch: need(m, 'arm64 support', 'ARCH_ARM64'), mode: end };
			return {
				arch: need(m, 'arm support', 'ARCH_ARM'),
				mode: (thumb ? need(m, 'thumb mode', 'MODE_THUMB') : need(m, 'arm mode', 'MODE_ARM')) | end
			};
		case 'mips':
			return {
				arch: need(m, 'mips support', 'ARCH_MIPS'),
				mode: need(m, `mips${bits}`, `MODE_MIPS${bits}`) | end
			};
		case 'powerpc':
		case 'ppc':
			return {
				arch: need(m, 'powerpc support', 'ARCH_PPC'),
				mode: need(m, `ppc${bits}`, `MODE_PPC${bits}`, `MODE_${bits}`) | end
			};
		case 'sparc':
			return {
				arch: need(m, 'sparc support', 'ARCH_SPARC'),
				mode: need(m, `sparc${bits}`, `MODE_SPARC${bits}`, `MODE_${bits}`) | end
			};
		default:
			throw new AsmError(`keystone cannot assemble ${processor}`);
	}
}

function csTarget(m: CsMod, a: Arch): { arch: number; mode: number } {
	const { processor, bits, endian, thumb } = readArch(a);
	const end = endian === 'big' ? need(m, 'big-endian mode', 'MODE_BIG_ENDIAN') : 0;

	switch (processor) {
		case 'x86':
			return {
				arch: need(m, 'x86 support', 'ARCH_X86'),
				mode: need(m, `${bits}-bit mode`, `MODE_${bits}`)
			};
		case 'aarch64':
		case 'arm64':
			return { arch: need(m, 'arm64 support', 'ARCH_ARM64'), mode: end };
		case 'arm':
			if (bits === 64) return { arch: need(m, 'arm64 support', 'ARCH_ARM64'), mode: end };
			return {
				arch: need(m, 'arm support', 'ARCH_ARM'),
				mode: (thumb ? need(m, 'thumb mode', 'MODE_THUMB') : konst(m, 'MODE_ARM') ?? 0) | end
			};
		case 'mips':
			return {
				arch: need(m, 'mips support', 'ARCH_MIPS'),
				mode: need(m, `mips${bits}`, `MODE_MIPS${bits}`) | end
			};
		case 'powerpc':
		case 'ppc':
			return {
				arch: need(m, 'powerpc support', 'ARCH_PPC'),
				mode: need(m, `ppc${bits}`, `MODE_${bits}`) | end
			};
		case 'sparc':
			return {
				arch: need(m, 'sparc support', 'ARCH_SPARC'),
				mode: (bits === 64 ? konst(m, 'MODE_V9') ?? 0 : 0) | end
			};
		case 'riscv':
			return {
				arch: need(m, 'riscv support', 'ARCH_RISCV'),
				mode: need(m, `riscv${bits}`, `MODE_RISCV${bits}`)
			};
		case '68000':
		case 'm68k':
			return {
				arch: need(m, 'm68k support', 'ARCH_M68K'),
				mode: konst(m, 'MODE_M68K_040') ?? 0
			};
		default:
			throw new AsmError(`capstone cannot disassemble ${processor}`);
	}
}

/** `"a1 b2"`, the one spelling patches are stored in. */
export function hexOf(bytes: Uint8Array | number[]): string {
	return Array.from(bytes)
		.map((b) => (b & 0xff).toString(16).padStart(2, '0'))
		.join(' ');
}

/**
 * Both engines report failure by throwing a plain string, so anything that is
 * not already one of ours becomes an `AsmError`: it is still something the user
 * typed, and it belongs in the editor's box rather than in a 500.
 */
function asAsmError(e: unknown): AsmError {
	if (e instanceof AsmError) return e;
	const text = e instanceof Error ? e.message : String(e);
	return new AsmError(text.replace(/^Keystone\.js: |^Capstone\.js: /, ''));
}

/** Text -> bytes. Throws `AsmError` with keystone's own complaint. */
export async function assemble(a: Arch, code: string, at: bigint): Promise<Uint8Array> {
	const m = await keystone();
	const { arch, mode } = ksTarget(m, a);
	let k: KsHandle;
	try {
		k = new m.Keystone(arch, mode);
	} catch (e) {
		throw asAsmError(e);
	}
	try {
		// Syntax is an x86 notion; keystone rejects the option outright on every
		// other architecture, and rejecting it means throwing.
		const intel = konst(m, 'OPT_SYNTAX_INTEL');
		const syntax = konst(m, 'OPT_SYNTAX');
		if (readArch(a).processor === 'x86' && intel !== undefined && syntax !== undefined) {
			k.option(syntax, intel);
		}
		const r = k.asm(code, Number(at));
		// `failed` is all the result carries; the reason is on the handle.
		if (r.failed) throw new AsmError(m.strerror(k.errno()).replace(/^KS_ERR_\w+:\s*/, ''));
		return r.mc;
	} catch (e) {
		throw asAsmError(e);
	} finally {
		k.close();
	}
}

/** Bytes -> instructions, addressed from `at` so relative targets read right. */
export async function disassemble(a: Arch, bytes: Uint8Array, at: bigint): Promise<Line[]> {
	const m = await capstone();
	const { arch, mode } = csTarget(m, a);
	let d: CsHandle;
	try {
		d = new m.Capstone(arch, mode);
	} catch (e) {
		throw asAsmError(e);
	}
	try {
		return d.disasm(Array.from(bytes), Number(at)).map((i) => ({
			addr: BigInt(i.address).toString(16),
			text: (i.mnemonic + (i.op_str ? ' ' + i.op_str : '')).trim(),
			size: i.size
		}));
	} catch (e) {
		throw asAsmError(e);
	} finally {
		d.close();
	}
}
