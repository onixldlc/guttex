<script lang="ts">
	// Dock divider. Owns no layout of its own: it just reports a new size for
	// the neighbouring grid track.
	let {
		value = $bindable(260),
		min = 140,
		max = 900,
		dir = 'x' as 'x' | 'y',
		invert = false
	} = $props();

	let dragging = $state(false);
	let origin = 0;
	let start = 0;

	function down(e: PointerEvent) {
		dragging = true;
		origin = dir === 'x' ? e.clientX : e.clientY;
		start = value;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		const now = dir === 'x' ? e.clientX : e.clientY;
		const delta = (now - origin) * (invert ? -1 : 1);
		value = Math.min(max, Math.max(min, start + delta));
	}

	function up(e: PointerEvent) {
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}

	function key(e: KeyboardEvent) {
		const step = e.shiftKey ? 40 : 10;
		const dec = dir === 'x' ? 'ArrowLeft' : 'ArrowUp';
		const inc = dir === 'x' ? 'ArrowRight' : 'ArrowDown';
		if (e.key === dec) value = Math.max(min, value - step * (invert ? -1 : 1));
		else if (e.key === inc) value = Math.min(max, value + step * (invert ? -1 : 1));
		else return;
		e.preventDefault();
	}
</script>

<!-- A focusable window splitter is a valid ARIA widget, but svelte's linter
     models role=separator as non-interactive, hence the ignores. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="split {dir}"
	class:dragging
	role="separator"
	tabindex="0"
	aria-label="resize dock"
	aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
	aria-valuenow={Math.round(value)}
	aria-valuemin={min}
	aria-valuemax={max}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onkeydown={key}
></div>

<style>
	.split {
		background: transparent;
		flex: none;
		position: relative;
		z-index: 2;
	}
	.split.x {
		width: 5px;
		margin: 0 -2px;
		cursor: col-resize;
	}
	.split.y {
		height: 5px;
		margin: -2px 0;
		cursor: row-resize;
	}
	.split:hover,
	.split.dragging,
	.split:focus-visible {
		background: var(--accent-dim);
		outline: none;
	}
</style>
