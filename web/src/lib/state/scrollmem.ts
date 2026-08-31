// Remembered scroll offset per decompiled function.
//
// Switching centre tabs unmounts the decompiler, so without this a trip to the
// disassembly and back drops you at the top of the function -- and reading a
// long function means scrolling to the same place over and over. Keyed by job
// + function entry, the same way `viewports` keys the graphs, so the offset
// follows the function rather than the selected address.
//
// Deliberately a sibling of `viewport.ts` rather than a generalisation of it:
// that one stores a transform and fits the graph when it has no entry, this one
// stores a number and has no such fallback. Same shape, different contract.
//
// Module scope so it survives unmount, sessionStorage so it survives a reload.
// Writes are coalesced -- a scroll event fires far more often than a store
// should be written.

const KEY = 'guttex.scroll';
const LIMIT = 300;

function load(): Map<string, number> {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, number>));
	} catch {
		// private mode, quota, or garbage from an older build -- start clean
	}
	return new Map();
}

class Scrolls {
	#tops: Map<string, number> | null = null;
	#flush: ReturnType<typeof setTimeout> | null = null;

	get #map(): Map<string, number> {
		if (!this.#tops) this.#tops = typeof sessionStorage === 'undefined' ? new Map() : load();
		return this.#tops;
	}

	get(key: string): number {
		return (key && this.#map.get(key)) || 0;
	}

	set(key: string, top: number) {
		if (!key || !Number.isFinite(top)) return;
		const m = this.#map;
		// re-insert so iteration order is least-recently-used first
		m.delete(key);
		m.set(key, Math.max(0, Math.round(top)));
		while (m.size > LIMIT) m.delete(m.keys().next().value as string);
		this.#schedule();
	}

	#schedule() {
		if (typeof sessionStorage === 'undefined' || this.#flush) return;
		this.#flush = setTimeout(() => {
			this.#flush = null;
			try {
				sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(this.#map)));
			} catch {
				// nothing to do about a full or blocked store; memory copy still works
			}
		}, 300);
	}
}

export const scrolls = new Scrolls();
