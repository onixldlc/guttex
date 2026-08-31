// Best-effort C line -> instructions.
//
// Ghidra knows exactly which instructions produced each line of decompiled C,
// but ghidra-rest does not serve that mapping (`Decompiled` carries `c` and
// nothing else), so this recovers what it can from the text on both sides:
// addresses, symbol names and string literals that appear in a C line, matched
// against the operands and comments of the function's own listing.
//
// It is a hint, not ground truth, and the UI says so. Lines built purely out of
// registers and stack slots -- `local_118 = local_120;` -- have nothing to
// anchor on and correctly return nothing.

import type { Instruction } from '$lib/api/types';
import { normAddr } from '$lib/format';

export type Hit = { ins: Instruction; why: string };

export interface AsmIndex {
	byAddr: Map<string, Instruction[]>;
	byName: Map<string, Instruction[]>;
	byStr: Map<string, Instruction[]>;
	terminals: Instruction[];
	count: number;
}

// Ghidra spells addresses as `0x401234`, `FUN_00401234`, `DAT_00405000`,
// `s_hello_00405010`. Four hex digits is the shortest that is worth trusting.
const HEX = /\b(?:0x|[A-Za-z]\w*_)0*([0-9a-fA-F]{4,16})\b/g;
const NAME = /\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g;
const STR = /"((?:[^"\\]|\\.)*)"/g;

// Register and keyword noise that would otherwise match every line.
const NOISE = new Set([
	'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp', 'eip',
	'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp', 'rsp', 'rip',
	'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
	'ax', 'bx', 'cx', 'dx', 'al', 'bl', 'cl', 'dl', 'ah', 'bh', 'ch', 'dh',
	'xmm0', 'xmm1', 'xmm2', 'xmm3', 'xmm4', 'xmm5', 'xmm6', 'xmm7',
	'byte', 'word', 'dword', 'qword', 'xmmword', 'ptr', 'offset', 'short', 'near', 'far',
	'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'goto',
	'sizeof', 'return', 'int', 'uint', 'char', 'void', 'long', 'float', 'double', 'bool',
	'unsigned', 'signed', 'undefined', 'undefined1', 'undefined2', 'undefined4', 'undefined8',
	'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
	'size_t', 'ssize_t', 'ulong', 'uchar', 'ushort', 'code', 'true', 'false', 'null'
]);

function push(m: Map<string, Instruction[]>, k: string, ins: Instruction) {
	const at = m.get(k);
	if (at) {
		if (at[at.length - 1] !== ins) at.push(ins);
	} else m.set(k, [ins]);
}

function interesting(name: string): boolean {
	// stack slots and registers say nothing about which instruction ran
	if (NOISE.has(name.toLowerCase())) return false;
	if (/^(?:local|[iu]Var|[a-z]Var|param|auStack|acStack|puVar|piVar)[0-9a-f_]*$/i.test(name))
		return false;
	return name.length >= 3;
}

/** Index one function's listing. Cheap enough to redo whenever the listing changes. */
export function indexAsm(instructions: Instruction[] | undefined): AsmIndex {
	const idx: AsmIndex = {
		byAddr: new Map(),
		byName: new Map(),
		byStr: new Map(),
		terminals: [],
		count: instructions?.length ?? 0
	};
	for (const ins of instructions ?? []) {
		const text = `${ins.operands ?? ''} ${ins.flow ?? ''} ${ins.comment ?? ''}`;
		if (ins.is_terminal) idx.terminals.push(ins);

		for (const m of text.matchAll(HEX)) push(idx.byAddr, normAddr(m[1]), ins);
		if (ins.flow) push(idx.byAddr, normAddr(ins.flow), ins);
		for (const m of text.matchAll(NAME)) if (interesting(m[1])) push(idx.byName, m[1], ins);
		for (const m of text.matchAll(STR)) if (m[1]) push(idx.byStr, m[1], ins);
		// Ghidra writes string data as a bare comment more often than a quoted one
		const c = ins.comment?.trim();
		if (c && !c.includes('"')) push(idx.byStr, c, ins);
	}
	return idx;
}

const LIMIT = 12;

/** Instructions that plausibly produced this line of C, lowest address first. */
export function mapLine(line: string, idx: AsmIndex): Hit[] {
	const text = line.trim();
	if (!text || text === '{' || text === '}') return [];

	const hits = new Map<string, Hit>();
	const take = (list: Instruction[] | undefined, why: string) => {
		for (const ins of list ?? []) {
			const key = normAddr(ins.address);
			// first reason wins: an address is a stronger claim than a name
			if (!hits.has(key)) hits.set(key, { ins, why });
		}
	};

	for (const m of text.matchAll(HEX)) take(idx.byAddr.get(normAddr(m[1])), `-> ${m[1]}`);
	for (const m of text.matchAll(STR)) if (m[1]) take(idx.byStr.get(m[1]), 'string');
	for (const m of text.matchAll(NAME)) if (interesting(m[1])) take(idx.byName.get(m[1]), m[1]);
	if (/^return\b/.test(text)) take(idx.terminals, 'return');

	// A line matching half the function is matching nothing in particular.
	if (hits.size > LIMIT * 3) return [];

	return [...hits.values()]
		.sort((a, b) => (normAddr(a.ins.address) < normAddr(b.ins.address) ? -1 : 1))
		.slice(0, LIMIT);
}
