<script lang="ts">
	// Pan/zoom viewport for the graph views. It owns the transform and nothing
	// else: the caller renders whatever it likes in content coordinates and this
	// moves it around. Wheel zooms at the pointer, drag on the background pans,
	// middle-drag pans from anywhere -- text inside blocks stays selectable.
	//
	// Given a `viewKey`, the transform is remembered for that key and restored
	// on the next mount, so leaving the tab and coming back lands where you left.
	import type { Snippet } from 'svelte';
	import { viewports } from '$lib/state/viewport';

	let {
		width = 0,
		height = 0,
		min = 0.08,
		max = 3,
		viewKey = '',
		children,
		toolbar
	}: {
		width: number;
		height: number;
		min?: number;
		max?: number;
		viewKey?: string;
		children?: Snippet;
		toolbar?: Snippet;
	} = $props();

	let vp = $state<HTMLDivElement | null>(null);
	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let panning = $state(false);

	const clamp = (s: number) => Math.min(max, Math.max(min, s));

	/** hand the current transform to the store; every mutation below ends here */
	function bank() {
		if (viewKey) viewports.set(viewKey, { scale, tx, ty });
	}

	// Restoring is a plain write of the three numbers -- no cleanup pass, since
	// every mutation has already banked itself.
	$effect(() => {
		const v = viewports.get(viewKey);
		if (!v) return;
		scale = v.scale;
		tx = v.tx;
		ty = v.ty;
	});

	function zoomAt(px: number, py: number, factor: number) {
		const ns = clamp(scale * factor);
		if (ns === scale) return;
		// keep the point under the cursor pinned
		tx = px - ((px - tx) * ns) / scale;
		ty = py - ((py - ty) * ns) / scale;
		scale = ns;
		bank();
	}

	export function zoom(factor: number) {
		if (!vp) return;
		zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, factor);
	}

	/** frame the whole graph: scale *and* position go back to the default */
	export function fit(pad = 24) {
		if (!vp || !width || !height) return;
		const s = clamp(Math.min((vp.clientWidth - pad * 2) / width, (vp.clientHeight - pad * 2) / height, 1));
		scale = s;
		tx = (vp.clientWidth - width * s) / 2;
		ty = pad;
		bank();
	}

	/** put a content-space rectangle in the middle of the viewport */
	export function focus(x: number, y: number, w = 0, h = 0, s = scale) {
		if (!vp) return;
		scale = clamp(s);
		tx = vp.clientWidth / 2 - (x + w / 2) * scale;
		ty = vp.clientHeight / 3 - (y + h / 2) * scale;
		bank();
	}

	/** move the view by a content-space delta, so a node stays put on screen
	    while the layout under it changes */
	export function shift(dx: number, dy: number) {
		tx -= dx * scale;
		ty -= dy * scale;
		bank();
	}

	export function reset() {
		scale = 1;
		tx = 0;
		ty = 0;
		bank();
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

	// --- touch ---
	// A phone has no wheel and no middle button, so the mouse path below never
	// fires: one finger pans from anywhere, two pinch-zoom. Touch pointers get
	// implicit capture, so the moves reach this element by bubbling while the
	// tap target stays whatever was under the finger -- taking explicit capture
	// would retarget the click and swallow taps on block links.
	const pts = new Map<number, { x: number; y: number }>();
	let pinch: { d: number; cx: number; cy: number } | null = null;

	function gauge() {
		const [a, b] = [...pts.values()];
		const r = vp!.getBoundingClientRect();
		return {
			d: Math.hypot(a.x - b.x, a.y - b.y),
			cx: (a.x + b.x) / 2 - r.left,
			cy: (a.y + b.y) / 2 - r.top
		};
	}

	function onPointerMove(e: PointerEvent) {
		if (e.pointerType !== 'touch') return;
		const prev = pts.get(e.pointerId);
		if (!prev || !vp) return;
		pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pts.size >= 2) {
			const g = gauge();
			if (pinch && pinch.d > 0) {
				// zoom about the old midpoint, then follow the new one, so a
				// two-finger drag pans and scales in the same gesture
				zoomAt(pinch.cx, pinch.cy, g.d / pinch.d);
				tx += g.cx - pinch.cx;
				ty += g.cy - pinch.cy;
			}
			pinch = g;
			return;
		}
		tx += e.clientX - prev.x;
		ty += e.clientY - prev.y;
		panning = true;
	}

	function onPointerUp(e: PointerEvent) {
		if (e.pointerType !== 'touch' || !pts.delete(e.pointerId)) return;
		if (pts.size < 2) pinch = null;
		if (pts.size === 0) {
			panning = false;
			bank();
		}
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === 'touch') {
			pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pts.size === 2 && vp) pinch = gauge();
			return;
		}
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
			bank();
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

<!-- the dot grid is part of the scene: it pans and zooms with the content,
     otherwise dragging a graph looks like the nodes are sliding over glass -->
<div
	class="vp"
	class:panning
	bind:this={vp}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	style:background-position="{tx}px {ty}px"
	style:background-size="{24 * scale}px {24 * scale}px"
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
