// What the listing currently has lit, so the right-click menu can copy it.
//
// The DOM selection on its own is not enough to copy from: it yields the exact
// glyphs that were dragged over, with no column structure, and two of the copy
// formats deliberately drop a whole column. So the listing publishes the rows
// it has highlighted and the menu formats them from the instruction records.

import type { Instruction } from '$lib/api/types';
import { displayAddr, normAddr } from '$lib/format';

/** `full` = as displayed, `addr` = address column only, `hex` = byte column
    only, `asm` = the instructions alone -- no addresses, no bytes. */
export type CopyKind = 'full' | 'addr' | 'hex' | 'asm';

class AsmSelection {
	/** every instruction in the listing on screen */
	lines = $state<Instruction[]>([]);
	/** inclusive row range the text selection spans; -1 when it covers one row */
	lo = $state(-1);
	hi = $state(-1);
	/** is the bytes column showing -- `full` copies what is actually on screen */
	bytes = $state(true);

	clear() {
		this.lines = [];
		this.lo = this.hi = -1;
	}

	/**
	 * The highlighted rows, or -- when nothing is highlighted -- the single row
	 * that was right-clicked. Copying one line is the common case and it should
	 * not need a drag first.
	 */
	rows(addr?: string): Instruction[] {
		if (this.lo >= 0 && this.hi >= this.lo) return this.lines.slice(this.lo, this.hi + 1);
		const a = normAddr(addr ?? '');
		const one = a ? this.lines.find((i) => normAddr(i.address) === a) : undefined;
		return one ? [one] : [];
	}

	format(kind: CopyKind, addr?: string): string {
		const rows = this.rows(addr);
		if (!rows.length) return '';
		if (kind === 'addr') return rows.map((i) => displayAddr(i.address)).join('\n');
		if (kind === 'hex') return rows.map((i) => i.bytes ?? '').join('\n');

		const withBytes = kind === 'full' && this.bytes;
		const cells = rows.map(
			(i) =>
				[
					kind === 'asm' ? null : displayAddr(i.address),
					withBytes ? (i.bytes ?? '') : null,
					i.mnemonic ?? '',
					i.operands ?? '',
					i.comment ? '; ' + i.comment : ''
				].filter((c) => c !== null) as string[]
		);
		// Widths come from the copied block alone, not the whole listing, so a
		// pasted excerpt lines up by itself.
		const w: number[] = [];
		for (const row of cells) row.forEach((c, k) => (w[k] = Math.max(w[k] ?? 0, c.length)));
		return cells
			.map((row) =>
				row
					.map((c, k) => (k === row.length - 1 ? c : c.padEnd(w[k])))
					.join('  ')
					.trimEnd()
			)
			.join('\n');
	}
}

export const asmSel = new AsmSelection();
