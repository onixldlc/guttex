// Listing syntax highlighting, modelled on how Cutter actually does it.
//
// Cutter doesn't colour text patterns -- rizin classifies each instruction into
// an analysis op type and paints the mnemonic with the matching palette entry
// (`ec mov`, `ec math`, `ec cjmp`, ...). The bucket names below are exactly
// rizin's palette keys, from librz/cons/pal.c, and the colours in app.css are
// the `ayu` theme, which is Cutter's `defaultDarkColorTheme`.
//
// We don't have rizin's analysis, so the bucket comes from the server's flow
// flags plus a mnemonic lookup. Wrong-looking colour beats invented structure:
// anything unrecognised falls through to the plain foreground.

import type { Tok } from './format';

// ------------------------------------------------------------- mnemonics

/** `ec mov` -- data movement, the listing's background noise. */
const MOV = new Set([
	'mov', 'movb', 'movw', 'movl', 'movq', 'movd', 'movs', 'movsb', 'movsw', 'movsd', 'movsq',
	'movzx', 'movsx', 'movsxd', 'movabs', 'movaps', 'movapd', 'movups', 'movdqa', 'movdqu',
	'lea', 'xchg', 'lods', 'stos', 'lodsb', 'stosb', 'stosd', 'cwde', 'cdqe', 'cdq', 'cqo', 'cbw',
	// arm / aarch64
	'ldr', 'ldrb', 'ldrh', 'ldrsb', 'ldrsh', 'ldrsw', 'ldur', 'ldp', 'str', 'strb', 'strh',
	'stur', 'stp', 'movk', 'movz', 'movn', 'mrs', 'msr', 'adrp', 'adr',
	// mips / riscv
	'lw', 'lh', 'lb', 'lbu', 'lhu', 'sw', 'sh', 'sb', 'li', 'la', 'lui', 'mv', 'ld', 'sd'
]);

/** `ec math` -- arithmetic. */
const MATH = new Set([
	'add', 'adc', 'sub', 'sbb', 'mul', 'imul', 'div', 'idiv', 'inc', 'dec', 'neg', 'xadd',
	'fadd', 'fsub', 'fmul', 'fdiv', 'addss', 'addsd', 'subss', 'subsd', 'mulss', 'mulsd',
	'adds', 'subs', 'rsb', 'mla', 'mls', 'madd', 'msub', 'mneg', 'sdiv', 'udiv', 'umull', 'smull',
	'addu', 'addiu', 'subu', 'addi', 'mult', 'multu', 'divu'
]);

/** `ec bin` -- bitwise and shifts. rizin keeps this separate from math. */
const BIN = new Set([
	'and', 'or', 'xor', 'not', 'shl', 'sal', 'shr', 'sar', 'shld', 'shrd',
	'rol', 'ror', 'rcl', 'rcr', 'bswap', 'bt', 'bts', 'btr', 'btc', 'bsf', 'bsr', 'popcnt',
	'eor', 'orr', 'orn', 'bic', 'mvn', 'lsl', 'lsr', 'asr', 'ubfx', 'sbfx', 'ubfm', 'sbfm',
	'sxtb', 'sxth', 'sxtw', 'uxtb', 'uxth', 'clz', 'rev', 'rbit',
	'andi', 'ori', 'xori', 'nor', 'sll', 'srl', 'sra', 'slli', 'srli', 'srai'
]);

/** `ec cmp` -- flag setters; the branch under them is the payoff. */
const CMP = new Set([
	'cmp', 'cmps', 'cmpsb', 'cmpsw', 'cmpsd', 'cmpsq', 'test', 'scas', 'scasb',
	'ucomiss', 'ucomisd', 'comiss', 'comisd', 'ptest', 'pcmpeqb', 'pcmpeqd', 'pcmpeqw',
	'tst', 'cmn', 'teq', 'ccmp', 'ccmn', 'fcmp', 'fcmpe',
	'slt', 'sltu', 'slti', 'sltiu'
]);

/** `ec push` / `ec pop` -- stack traffic. */
const PUSH = new Set(['push', 'pusha', 'pushad', 'pushf', 'pushfd', 'pushfq', 'enter', 'stmdb']);
const POP = new Set(['pop', 'popa', 'popad', 'popf', 'popfd', 'popfq', 'leave', 'ldmia']);

/** `ec nop` -- padding and hints; ayu dims these to purple. */
const NOP = new Set([
	'nop', 'nopl', 'nopw', 'fnop', 'pause', 'wait', 'fwait',
	'endbr32', 'endbr64', 'bti', 'yield', 'hint', 'dsb', 'dmb', 'isb'
]);

/** `ec trap` -- breakpoints and undefined instructions. */
const TRAP = new Set(['int3', 'int1', 'ud0', 'ud1', 'ud2', 'hlt', 'brk', 'bkpt', 'trap']);

/** `ec swi` -- software interrupts / syscalls. */
const SWI = new Set(['int', 'into', 'syscall', 'sysenter', 'sysexit', 'svc', 'swi', 'ecall', 'sc']);

/** Conditional branch names, so `jmp` and `cjmp` can carry separate colours
    the way rizin's palette does (ayu happens to paint them the same). */
const CJMP =
	/^(?:j(?:[abgl]e?|n?[abcegloprsz]|p[eo]|cxz|ecxz|rcxz)|b(?:eq|ne|cs|hs|cc|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le)|cb n?z|cbz|cbnz|tbz|tbnz|beqz|bnez|bltz|bgez|blez|bgtz|bne|beq)$/i;

/**
 * The palette bucket for one instruction, named after rizin's `ec` keys.
 * Call/jump/return come from the server's own flags, so they hold on every
 * architecture; everything else is a mnemonic lookup and returns '' when
 * unrecognised.
 */
export function mnemonicClass(i: {
	mnemonic?: string;
	flow?: string;
	is_call?: boolean;
	is_jump?: boolean;
	is_terminal?: boolean;
}): string {
	const m = (i.mnemonic ?? '').toLowerCase();
	// An indirect call/jump has no single destination -- rizin gives those their
	// own keys (ucall/ujmp) because they're the ones worth a second look.
	if (i.is_call) return i.flow ? 'call' : 'ucall';
	if (i.is_jump) return i.flow ? (CJMP.test(m) ? 'cjmp' : 'jmp') : 'ujmp';
	if (i.is_terminal) return TRAP.has(m) ? 'trap' : 'ret';
	if (!m) return '';
	if (MOV.has(m) || m.startsWith('cmov') || m.startsWith('fmov')) return 'mov';
	if (CMP.has(m)) return 'cmp';
	if (MATH.has(m)) return 'math';
	if (BIN.has(m) || m.startsWith('set') || m.startsWith('cset')) return 'bin';
	if (PUSH.has(m)) return 'push';
	if (POP.has(m)) return 'pop';
	if (NOP.has(m)) return 'nop';
	if (TRAP.has(m)) return 'trap';
	if (SWI.has(m)) return 'swi';
	return '';
}

// -------------------------------------------------------------- operands

/**
 * Register names across the architectures ghidra-rest is likely to hand back
 * (`ec reg`). Matched whole-token and case-insensitively, so a symbol that
 * merely contains `ax` or `r1` is left alone.
 */
const REG =
	/^(?:[er]?(?:ax|bx|cx|dx|si|di|bp|sp|ip)|[a-d][lh]|sil|dil|bpl|spl|r(?:[89]|1[0-5])[bwd]?|[cdefgs]s|[xyz]mm\d{1,2}|st\d|mm[0-7]|[cd]r\d{1,2}|tr\d|[xw](?:\d|[12]\d|3[01])|[qdsbhv]\d{1,2}|r\d{1,2}|wsp|wzr|xzr|zr|lr|pc|fp|sl|sb|lo|hi|fpsr|fpcr|cpsr|nzcv|zero|at|gp|tp|ra|[vk]\d)$/i;

/** Operand-size and addressing noise: `dword ptr`, `short`, `lsl`. */
const SIZES = new Set([
	'byte', 'word', 'dword', 'qword', 'tbyte', 'oword', 'xmmword', 'ymmword', 'zmmword',
	'ptr', 'short', 'near', 'far', 'offset', 'uxtw', 'sxtw'
]);

const ASM_ID = /[A-Za-z_.$@][A-Za-z0-9_.$@]*/y;
const ASM_NUM = /(?:0[xX][0-9a-fA-F]+|\d+)[hbHB]?/y;

/**
 * Split one operand string into palette-classed tokens: `reg`, `num`, `flag`
 * (a symbol or label), `size`, `punct`. Rendered as spans by the caller, so
 * listing text is never injected as HTML.
 */
export function tokenizeAsm(src: string | undefined): Tok[] {
	const s = src ?? '';
	const out: Tok[] = [];
	const push = (t: string, c: string) => {
		if (t) out.push({ t, c });
	};
	let i = 0;

	while (i < s.length) {
		const ch = s[i];

		if (ch === ' ' || ch === '\t') {
			let j = i;
			while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
			push(s.slice(i, j), 'plain');
			i = j;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < s.length && s[j] !== ch) {
				if (s[j] === '\\') j++;
				j++;
			}
			push(s.slice(i, Math.min(j + 1, s.length)), 'str');
			i = j + 1;
			continue;
		}
		if (ch >= '0' && ch <= '9') {
			ASM_NUM.lastIndex = i;
			const m = ASM_NUM.exec(s);
			if (m) {
				push(m[0], 'num');
				i += m[0].length;
				continue;
			}
		}
		if (/[A-Za-z_.$@]/.test(ch)) {
			ASM_ID.lastIndex = i;
			const m = ASM_ID.exec(s);
			if (m) {
				const w = m[0];
				push(w, SIZES.has(w.toLowerCase()) ? 'size' : REG.test(w) ? 'reg' : 'flag');
				i += w.length;
				continue;
			}
		}
		push(ch, 'punct');
		i++;
	}
	return out;
}
