// Node sizes for the graph layouts, straight from the browser.
//
// Guessing widths from character counts is wrong at every font but one, and
// measuring from a component `$effect` is worse: that effect is created before
// the children it wants to measure, so on the first pass it finds nothing and
// the layout keeps its placeholder sizes -- which is exactly how blocks end up
// drawn on top of each other. A ResizeObserver attached by the node's own
// action reports after layout, every time, including when a webfont lands.

export interface Size {
	w: number;
	h: number;
}

export class Measured {
	sizes = $state<Record<string, Size>>({});

	#ro: ResizeObserver | null = null;
	#id = new WeakMap<Element, string>();
	#pending = new Map<string, Size>();
	#frame = 0;

	#flush = () => {
		this.#frame = 0;
		if (!this.#pending.size) return;
		const next = { ...this.sizes };
		let changed = false;
		for (const [id, s] of this.#pending) {
			const old = next[id];
			if (!old || old.w !== s.w || old.h !== s.h) {
				next[id] = s;
				changed = true;
			}
		}
		this.#pending.clear();
		if (changed) this.sizes = next;
	};

	#queue(id: string, el: HTMLElement) {
		this.#pending.set(id, { w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) });
		// One batch per frame: a hundred blocks resolving together is one layout
		// pass, not a hundred.
		this.#frame ||= requestAnimationFrame(this.#flush);
	}

	/** svelte action: `use:reg={id}` on the element that is the node */
	node = (el: HTMLElement, id: string) => {
		this.#id.set(el, id);
		if (typeof ResizeObserver !== 'undefined') {
			this.#ro ??= new ResizeObserver((entries) => {
				for (const e of entries) {
					const key = this.#id.get(e.target);
					if (key) this.#queue(key, e.target as HTMLElement);
				}
			});
			this.#ro.observe(el);
		} else {
			this.#queue(id, el);
		}
		return {
			destroy: () => {
				this.#ro?.unobserve(el);
				this.#id.delete(el);
				this.#pending.delete(id);
				if (this.sizes[id]) {
					const next = { ...this.sizes };
					delete next[id];
					this.sizes = next;
				}
			}
		};
	};

	/** true once at least one node has reported, i.e. the layout is real */
	get ready() {
		return Object.keys(this.sizes).length > 0;
	}
}
