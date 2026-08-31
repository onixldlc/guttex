// Remembered pan/zoom per graph view.
//
// Switching centre tabs unmounts the graph, so without this every trip through
// the disassembly tab and back would drop the user at the default fit. Views
// are keyed by what is being drawn (job + function entry), not by the selected
// address, so clicking a block inside a function keeps the view you set up.
//
// Kept in module scope so it survives unmount, mirrored into sessionStorage so
// it also survives a reload. Writes are coalesced -- panning banks on every
// pointer-up and zooming on every wheel tick, and neither should hit storage
// that often.

export type View = { scale: number; tx: number; ty: number };

const KEY = 'guttex.viewports';
const LIMIT = 200;

function load(): Map<string, View> {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, View>));
	} catch {
		// private mode, quota, or garbage from an older build -- start clean
	}
	return new Map();
}

class Viewports {
	#views: Map<string, View> | null = null;
	#flush: ReturnType<typeof setTimeout> | null = null;

	get #map(): Map<string, View> {
		if (!this.#views) this.#views = typeof sessionStorage === 'undefined' ? new Map() : load();
		return this.#views;
	}

	has(key: string): boolean {
		return !!key && this.#map.has(key);
	}

	get(key: string): View | undefined {
		return key ? this.#map.get(key) : undefined;
	}

	set(key: string, v: View) {
		if (!key || !Number.isFinite(v.scale) || !Number.isFinite(v.tx) || !Number.isFinite(v.ty))
			return;
		const m = this.#map;
		// re-insert so iteration order is least-recently-used first
		m.delete(key);
		m.set(key, v);
		while (m.size > LIMIT) m.delete(m.keys().next().value as string);
		this.#schedule();
	}

	del(key: string) {
		if (this.#map.delete(key)) this.#schedule();
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

export const viewports = new Viewports();
