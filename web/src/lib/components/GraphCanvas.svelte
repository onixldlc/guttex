<script lang="ts">
	// Pan/zoom viewport for the graph views. It owns the transform and nothing
	// else: the caller renders whatever it likes in content coordinates and this
	// moves it around. Wheel zooms at the pointer, drag on the background pans,
	// middle-drag pans from anywhere -- text inside blocks stays selectable.
	import type { Snippet } from 'svelte';

	let {
		width = 0,
		height = 0,
		min = 0.08,
		max = 3,
		children,
		toolbar
	}: {
		width: number;
		height: number;
		min?: number;
		max?: number;
		children?: Snippet;
		toolbar?: Snippet;
	} = $props();

	let vp = $state<HTMLDivElement | null>(null);
	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let panning = $state(false);

	const clamp = (s: number) => Math.min(max, Math.max(min, s));

	function zoomAt(px: number, py: number, factor: number) {
		const ns = clamp(scale * factor);
		if (ns === scale) return;
		// keep the point under the cursor pinned
		tx = px - ((px - tx) * ns) / scale;
		ty = py - ((py - ty) * ns) / scale;
		scale = ns;
	}

	export function zoom(factor: number) {
		if (!vp) return;
		zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, factor);
	}

	export function fit(pad = 24) {
		if (!vp || !width || !height) return;
		const s = clamp(Math.min((vp.clientWidth - pad * 2) / width, (vp.clientHeight - pad * 2) / height, 1));
		scale = s;
		tx = (vp.clientWidth - width * s) / 2;
		ty = pad;
	}

	/** put a content-space rectangle in the middle of the viewport */
	export function focus(x: number, y: number, w = 0, h = 0, s = scale) {
		if (!vp) return;
		scale = clamp(s);
		tx = vp.clientWidth / 2 - (x + w / 2) * scale;
		ty = vp.clientHeight / 3 - (y + h / 2) * scale;
	}

	/** move the view by a content-space delta, so a node stays put on screen
	    while the layout under it changes */
	export function shift(dx: number, dy: number) {
		tx -= dx * scale;
		ty -= dy * scale;
	}

	export function reset() {
		scale = 1;
		tx = 0;
		ty = 0;
	}

	// Non-passive, because zooming a graph must not also scroll the page.
	$effect(() => {
		const el = vp;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = el.getBoundingClientRect();
			zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	function onPointerDown(e: PointerEvent) {
		const hit = e.target as HTMLElement | null;
		// The toolbar lives inside the viewport. Starting a pan on it would
		// preventDefault the press and the button would never see its click.
		if (hit?.closest?.('.tools')) return;
		const onBackground = hit?.closest?.('.gnode') === null;
		if (e.button !== 1 && !(e.button === 0 && onBackground)) return;
		e.preventDefault();
		panning = true;
		const sx = e.clientX - tx;
		const sy = e.clientY - ty;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (m: PointerEvent) => {
			tx = m.clientX - sx;
			ty = m.clientY - sy;
		};
		const up = () => {
			panning = false;
			el.releasePointerCapture?.(e.pointerId);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}
</script>

<div
	class="vp"
	class:panning
	bind:this={vp}
	onpointerdown={onPointerDown}
	role="application"
	aria-label="graph"
>
	<div class="content" style:width="{width}px" style:height="{height}px" style:transform="translate({tx}px, {ty}px) scale({scale})">
		{@render children?.()}
	</div>

	<div class="tools">
		{@render toolbar?.()}
		<button title="zoom in" onclick={() => zoom(1.25)}>+</button>
		<button title="zoom out" onclick={() => zoom(0.8)}>-</button>
		<button title="fit" onclick={() => fit()}>fit</button>
		<span class="pct">{Math.round(scale * 100)}%</span>
	</div>
</div>

<style>
	.vp {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		background: var(--bg);
		background-image: radial-gradient(var(--border-soft) 1px, transparent 1px);
		background-size: 24px 24px;
		cursor: grab;
		touch-action: none;
	}
	.vp.panning {
		cursor: grabbing;
	}
	.content {
		position: absolute;
		inset: 0 auto auto 0;
		transform-origin: 0 0;
	}
	.tools {
		position: absolute;
		right: 10px;
		bottom: 10px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.tools button {
		min-width: 26px;
		padding: 2px 6px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}
	.pct {
		font-size: 11px;
		color: var(--fg-dim);
		min-width: 38px;
		text-align: right;
	}
</style>
