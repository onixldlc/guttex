// Which instructions the listing should light up, and where they came from.
//
// The decompiler's hover card already answers "what is behind this line?" --
// but it answers it in a 40vh popup that disappears. This carries the same
// answer to the disassembly tab: click a mapped line number (or right-click the
// line) and the listing opens with exactly those instructions backed, so the
// mapping can be read in context instead of through a keyhole. The graph's
// right-click menu marks a single instruction through the same store, so both
// tabs hand over to the listing the same way.
//
// Marks are scoped to the function they were taken in. Selecting another
// function does not clear them -- the listing simply stops honouring them, and
// they come back if you navigate back. Nothing here writes to Ghidra.

import { normAddr } from '$lib/format';

/** what a line of C compiled to, in the function the decompiler has open */
export type LineHits = { fn: string; addrs: string[] };

class AsmMark {
	/** entry address of the function the marks belong to */
	fn = $state('');
	/** decompiler line they were taken from; 0 when nothing is marked */
	line = $state(0);
	/** marked instruction addresses, normalised, in listing order */
	addrs = $state<string[]>([]);
	/** where they came from, for the listing's chip: `line 67`, `graph` */
	label = $state('');

	/**
	 * Resolves a line to its instructions. Published by the decompiler while it
	 * is mounted, because that is what holds the listing, the index and the
	 * text-match fallback -- the right-click menu is a global component with
	 * none of that, and should not grow a second copy of it.
	 */
	source = $state<((line: number) => Promise<LineHits>) | null>(null);

	/**
	 * The function the centre view has open and the addresses in it. Published
	 * by the graph while it is mounted. The listing is fetched per *function*,
	 * so handing it a mid-function address navigates to nothing -- the menu
	 * needs this to tell an instruction inside the function (mark it, keep the
	 * function) from a call that leaves it (navigate to it).
	 */
	scope = $state<{ fn: string; has: (addr: string) => boolean } | null>(null);

	/** membership test for the row loop, so it stays O(1) per row */
	hot = $derived(new Set(this.addrs));

	get count() {
		return this.addrs.length;
	}

	set(fn: string, line: number, addrs: string[], label = line ? `line ${line}` : '') {
		this.fn = normAddr(fn);
		this.line = line;
		this.label = label;
		this.addrs = addrs.map(normAddr).filter(Boolean);
	}

	/** resolve and mark; false when the line compiled to nothing we can find */
	async goto(line: number): Promise<boolean> {
		const src = this.source;
		if (!src) return false;
		const { fn, addrs } = await src(line);
		if (!addrs.length) return false;
		this.set(fn, line, addrs);
		return true;
	}

	/** are these marks about the function on screen? */
	owns(fn: string | undefined) {
		return !!this.fn && !!this.addrs.length && this.fn === normAddr(fn ?? '');
	}

	has(addr: string) {
		return this.hot.has(normAddr(addr));
	}

	clear() {
		this.fn = '';
		this.line = 0;
		this.label = '';
		this.addrs = [];
	}
}

export const asmMark = new AsmMark();
