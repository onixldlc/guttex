// Virtual address -> file offset, for applying patches to the binary on its
// way out.
//
// Patches are keyed by the address the user saw in the views, which is a
// Ghidra address: image base plus offset. The bytes live in the file at
// wherever the executable's headers say that address is loaded from. This
// reads just enough ELF / PE to answer that -- program headers on one side,
// section table on the other -- and refuses formats it does not know rather
// than corrupting them with a guess.
//
// A file with no recognisable header is treated as a flat image loaded at the
// given base: address minus base is the offset. That is exactly how Ghidra
// treats a raw binary, so the two agree.

/** one file-backed mapping: [vaddr, vaddr+size) lives at [off, off+size) */
type Seg = { vaddr: bigint; off: number; size: number };

export type PatchMap = {
	format: 'elf' | 'pe' | 'flat';
	/** the base the file was linked for; Ghidra's base may differ (PIE, rebase) */
	linkBase: bigint;
	segs: Seg[];
};

export class Unmapped extends Error {}

const rd = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export function buildMap(file: Uint8Array): PatchMap {
	const v = rd(file);
	if (file.length >= 0x40 && v.getUint32(0, false) === 0x7f454c46) return elf(file, v);
	if (file.length >= 0x40 && v.getUint16(0, true) === 0x5a4d) {
		const pe = tryPE(file, v);
		if (pe) return pe;
	}
	// Mach-O magics: known, unsupported, and silently mispatching one would be
	// worse than saying so.
	if (file.length >= 4) {
		const m = v.getUint32(0, false);
		if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe || m === 0xcafebabe) {
			throw new Unmapped('Mach-O patching is not supported');
		}
	}
	return { format: 'flat', linkBase: 0n, segs: [{ vaddr: 0n, off: 0, size: file.length }] };
}

function elf(file: Uint8Array, v: DataView): PatchMap {
	const is64 = file[4] === 2;
	const le = file[5] !== 2;
	const u16 = (o: number) => v.getUint16(o, le);
	const u32 = (o: number) => v.getUint32(o, le);
	const u64 = (o: number) => v.getBigUint64(o, le);

	const phoff = is64 ? Number(u64(0x20)) : u32(0x1c);
	const phentsize = u16(is64 ? 0x36 : 0x2a);
	const phnum = u16(is64 ? 0x38 : 0x2c);

	const segs: Seg[] = [];
	for (let i = 0; i < phnum; i++) {
		const p = phoff + i * phentsize;
		if (p + phentsize > file.length) break;
		if (u32(p) !== 1) continue; // PT_LOAD
		const off = is64 ? Number(u64(p + 8)) : u32(p + 4);
		const vaddr = is64 ? u64(p + 16) : BigInt(u32(p + 8));
		const filesz = is64 ? Number(u64(p + 32)) : u32(p + 16);
		if (filesz > 0) segs.push({ vaddr, off, size: filesz });
	}
	if (!segs.length) throw new Unmapped('ELF with no PT_LOAD segments');
	const linkBase = segs.reduce((m, s) => (s.vaddr < m ? s.vaddr : m), segs[0].vaddr);
	return { format: 'elf', linkBase, segs };
}

function tryPE(file: Uint8Array, v: DataView): PatchMap | null {
	const lfanew = v.getUint32(0x3c, true);
	if (lfanew + 24 > file.length || v.getUint32(lfanew, true) !== 0x00004550) return null;

	const nsec = v.getUint16(lfanew + 6, true);
	const optSize = v.getUint16(lfanew + 20, true);
	const opt = lfanew + 24;
	const magic = v.getUint16(opt, true);
	const linkBase =
		magic === 0x20b ? v.getBigUint64(opt + 24, true) : BigInt(v.getUint32(opt + 28, true));

	// headers are mapped 1:1 at the base, below the first section
	const segs: Seg[] = [];
	let headerEnd = Number.MAX_SAFE_INTEGER;
	const secs = opt + optSize;
	for (let i = 0; i < nsec; i++) {
		const s = secs + i * 40;
		if (s + 40 > file.length) break;
		const va = v.getUint32(s + 12, true);
		const rawSize = v.getUint32(s + 16, true);
		const rawPtr = v.getUint32(s + 20, true);
		if (rawSize > 0) segs.push({ vaddr: linkBase + BigInt(va), off: rawPtr, size: rawSize });
		if (va < headerEnd) headerEnd = va;
	}
	if (headerEnd > 0 && headerEnd !== Number.MAX_SAFE_INTEGER) {
		segs.push({ vaddr: linkBase, off: 0, size: headerEnd });
	}
	return { format: 'pe', linkBase, segs };
}

/**
 * File offset of one byte. `base` is what Ghidra called the image base; the
 * difference between it and the file's own base is the rebase (PIE ELFs land
 * at 0x100000 by default) and is subtracted back out before the lookup.
 */
export function fileOffset(map: PatchMap, base: bigint, addr: bigint): number {
	const va = addr - (base - map.linkBase);
	for (const s of map.segs) {
		if (va >= s.vaddr && va < s.vaddr + BigInt(s.size)) {
			return s.off + Number(va - s.vaddr);
		}
	}
	throw new Unmapped(`0x${addr.toString(16)} is not backed by the file (uninitialised data?)`);
}
