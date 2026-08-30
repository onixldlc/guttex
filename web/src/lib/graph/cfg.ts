// Basic blocks out of a flat instruction listing.
//
// ghidra-rest ships the listing, not the control-flow graph, so the blocks are
// recovered here the textbook way: a block starts at the function entry, at any
// address something inside the function jumps to, and after every branch. Calls
// do not split a block -- they return, and Ghidra and Cutter both draw them
// inline.

import type { Instruction } from '$lib/api/types';
import { mnemonicClass } from '$lib/asmtok';
import { normAddr } from '$lib/format';

/** `true`/`false` are the two sides of a conditional; `jump` is unconditional;
    `next` is plain fallthrough into the following block. */
export type EdgeKind = 'true' | 'false' | 'jump' | 'next';

export interface CfgEdge {
	from: string;
	to: string;
	kind: EdgeKind;
}

export interface CfgBlock {
	/** normalised address of the first instruction; the block's id */
	id: string;
	instructions: Instruction[];
	/** the block ends on a branch whose destination is not a single known
	    address inside this function -- an indirect jump, a switch, a tail call */
	unresolved?: boolean;
}

export interface Cfg {
	entry: string;
	blocks: CfgBlock[];
	edges: CfgEdge[];
}

export function buildCfg(instructions: Instruction[] | undefined): Cfg | null {
	const ins = instructions ?? [];
	if (!ins.length) return null;

	const addr = ins.map((i) => normAddr(i.address));
	const known = new Set(addr);

	// leaders: entry, every in-function branch target, every post-branch address
	const leaders = new Set<string>([addr[0]]);
	for (let i = 0; i < ins.length; i++) {
		const branch = !!ins[i].is_jump || !!ins[i].is_terminal;
		if (!branch) continue;
		if (addr[i + 1]) leaders.add(addr[i + 1]);
		const t = normAddr(ins[i].flow ?? '');
		if (ins[i].is_jump && t && known.has(t)) leaders.add(t);
	}

	const blocks: CfgBlock[] = [];
	let cur: CfgBlock | null = null;
	for (let i = 0; i < ins.length; i++) {
		if (!cur || leaders.has(addr[i])) {
			cur = { id: addr[i], instructions: [] };
			blocks.push(cur);
		}
		cur.instructions.push(ins[i]);
	}

	const byId = new Map(blocks.map((b) => [b.id, b]));
	const edges: CfgEdge[] = [];
	for (let b = 0; b < blocks.length; b++) {
		const blk = blocks[b];
		const last = blk.instructions[blk.instructions.length - 1];
		const fall = blocks[b + 1]?.id;
		const target = normAddr(last.flow ?? '');
		const inFunc = target && byId.has(target) ? target : '';
		const kind = mnemonicClass(last);

		if (last.is_terminal) continue; // ret/hlt: the block just ends
		if (last.is_jump) {
			if (kind === 'cjmp') {
				// A conditional has both sides: the taken one is the branch target,
				// the other is whatever follows in memory. False goes first because
				// the layout walks edges in order -- so the not-taken path settles on
				// the left and the taken path keeps heading right, which is the shape
				// an if/else is read in.
				if (fall) edges.push({ from: blk.id, to: fall, kind: 'false' });
				if (inFunc) edges.push({ from: blk.id, to: inFunc, kind: 'true' });
				else blk.unresolved = true;
			} else if (inFunc) {
				edges.push({ from: blk.id, to: inFunc, kind: 'jump' });
			} else {
				// indirect jump, switch, or a tail call out of the function
				blk.unresolved = true;
			}
			continue;
		}
		if (fall) edges.push({ from: blk.id, to: fall, kind: 'next' });
	}

	return { entry: blocks[0].id, blocks, edges };
}
