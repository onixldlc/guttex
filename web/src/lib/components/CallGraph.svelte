<script lang="ts">
	// The global graph: a call tree from an entry point outward. Only the
	// branches that are open are drawn, because a real binary has tens of
	// thousands of functions and drawing all of them helps nobody.
	//
	// The edge set itself comes from one walk of the function list, cached in
	// IndexedDB per job -- so this is slow exactly once per binary.
	//
	// Which root and which branches are open live in `callGraphView`, outside
	// this component. This is the map of the whole binary rather than a view of
	// one function: walking into a callee, switching tabs or hitting back must
	// not throw the map away and drop you back at the entry point.
	import { untrack } from 'svelte';
	import { session } from '$lib/state/session.svelte';
	import { callGraphView as cg } from '$lib/state/callgraph.svelte';
	import { dispName } from '$lib/state/renames.svelte';
	import { displayAddr, normAddr } from '$lib/format';
	import { layered, type Layout } from '$lib/graph/layout';
	import { buildTree } from '$lib/graph/callgraph';
	import { Measured } from '$lib/graph/measure.svelte';
	import GraphCanvas from './GraphCanvas.svelte';

	let canvas = $state<GraphCanvas | null>(null);

	$effect(() => {
		const job = session.id;
		untrack(() => cg.ensure(job));
	});

	let opened = $derived(new Set(cg.open));
	let tree = $derived(cg.graph && cg.root ? buildTree(cg.graph, cg.root, opened) : null);

	// Opening a branch can make everything above it wider, which slides the
	// whole layout sideways. The node that was clicked is held still on screen
	// instead, so the tree grows around it rather than teleporting away.
	let anchor = $state<{ id: string; x: number; y: number } | null>(null);

	function toggle(id: string) {
		const p = layout?.nodes.get(id);
		anchor = p ? { id, x: p.x, y: p.y } : null;
		cg.toggle(id);
	}

	// sizes measured from the DOM, same as the function graph
	const measured = new Measured();
	const reg = measured.node;

	let layout = $derived.by((): Layout | null => {
		if (!tree || !tree.nodes.length) return null;
		return layered(
			tree.nodes.map((n) => ({ id: n.id, ...(measured.sizes[n.id] ?? { w: 180, h: 34 }) })),
			tree.edges,
			{ root: cg.root, rankGap: 40, nodeGap: 20 }
		);
	});

	// Frame on a new root only, and only the first time that root is drawn --
	// `cg.framed` outlives the component, so coming back to the tab keeps the
	// view you had. Refitting on every expand would yank it out from under you.
	$effect(() => {
		const l = layout;
		if (!l || !cg.root || cg.framed === cg.root || !measured.ready) return;
		cg.framed = cg.root;
		untrack(() => canvas?.fit());
	});

	$effect(() => {
		const l = layout;
		const a = anchor;
		if (!l || !a) return;
		const p = l.nodes.get(a.id);
		if (!p) {
			anchor = null;
			return;
		}
		const dx = p.x - a.x;
		const dy = p.y - a.y;
		if (!dx && !dy) return; // settled; hold the anchor for the size pass
		anchor = { id: a.id, x: p.x, y: p.y };
		untrack(() => canvas?.shift(dx, dy));
	});

	const poly = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(' ');
	let rootList = $derived(cg.graph ? cg.graph.roots.slice(0, 400) : []);
</script>

<div class="wrap">
	<div class="sub">
		{#if cg.graph}
			<label class="pick">
				root
				<select value={cg.root} onchange={(e) => cg.setRoot(e.currentTarget.value)}>
					{#each rootList as r (r)}
						<option value={r}
							>{dispName(session.project, r, cg.graph.nodes[r]?.name ?? r)} &nbsp; {displayAddr(
								r
							)}</option
						>
					{/each}
				</select>
			</label>
			<button
				class="mini"
				title="use the address selected elsewhere as the root"
				disabled={!session.addr || !cg.graph.nodes[normAddr(session.addr)]}
				onclick={() => cg.setRoot(normAddr(session.addr))}
			>
				root at selection
			</button>
			<span class="dim">{cg.graph.count} functions</span>
			<span class="spacer"></span>
			<span class="dim" title={cg.graph.built}
				>cached {new Date(cg.graph.built).toLocaleString()}</span
			>
			<button class="mini" onclick={() => cg.rebuild(session.id)} disabled={cg.loading}
				>rebuild</button
			>
		{:else}
			<span class="dim">{cg.progress || 'call graph'}</span>
		{/if}
	</div>

	{#if cg.loading}
		<p class="empty">{cg.progress || 'building call graph...'}</p>
	{:else if cg.error}
		<p class="empty err">{cg.error}</p>
	{:else if tree && layout}
		<GraphCanvas
			bind:this={canvas}
			width={layout.width}
			height={layout.height}
			viewKey={cg.key}
		>
			{#snippet toolbar()}
				{#if tree.capped}<span class="cap" title="expand fewer branches">capped</span>{/if}
				<button title="collapse all" onclick={() => cg.collapse()}>collapse</button>
			{/snippet}
			{#snippet children()}
				<svg class="edges" width={layout.width} height={layout.height} aria-hidden="true">
					<defs>
						<marker
							id="cg-arrow"
							viewBox="0 0 8 8"
							refX="7"
							refY="4"
							markerWidth="6"
							markerHeight="6"
							orient="auto-start-reverse"
						>
							<path d="M0,0 L8,4 L0,8 z" />
						</marker>
					</defs>
					{#each layout.routes as r, i (i)}
						<polyline class="edge" points={poly(r.points)} marker-end="url(#cg-arrow)" />
					{/each}
				</svg>

				{#each tree.nodes as n (n.id)}
					{@const p = layout.nodes.get(n.id)}
					<div
						class="gnode"
						class:open={opened.has(n.id)}
						class:ext={n.ext}
						class:recursive={n.recursive}
						class:cursor={n.addr === normAddr(session.addr)}
						style:left="{p?.x ?? 0}px"
						style:top="{p?.y ?? 0}px"
						use:reg={n.id}
						data-addr={n.addr}
						data-name={n.name}
					>
						<button
							class="knob"
							disabled={!n.kids}
							title={n.recursive ? 'already on this path' : n.kids ? 'expand' : 'calls nothing'}
							onclick={() => n.kids && toggle(n.id)}
						>
							{n.recursive ? '@' : !n.kids ? '.' : opened.has(n.id) ? '-' : '+'}
						</button>
						<button
							class="label"
							title="open {dispName(session.project, n.addr, n.name)}"
							ondblclick={() => session.select(n.addr, 'graph')}
							onclick={() => n.kids && toggle(n.id)}
						>
							<span class="nm">{dispName(session.project, n.addr, n.name)}</span>
							<span class="ad mono">{displayAddr(n.addr)}</span>
							{#if n.kids}<span class="kids">{n.kids}</span>{/if}
						</button>
					</div>
				{/each}
			{/snippet}
		</GraphCanvas>
	{:else if cg.graph}
		<p class="empty">nothing to draw -- no entry point and nothing callerless</p>
	{:else}
		<p class="empty">no call graph</p>
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--fg-dim);
	}
	.pick select {
		max-width: 320px;
		font-size: 11px;
	}
	.mini {
		font-size: 11px;
		padding: 2px 6px;
		text-transform: none;
		letter-spacing: 0;
	}
	.edges {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.edge {
		fill: none;
		stroke: var(--edge-next);
		stroke-width: 1.4;
	}
	.edges path {
		fill: var(--edge-next);
	}
	.cap {
		font-size: 10px;
		color: var(--ec-trap);
		text-transform: uppercase;
	}

	.gnode {
		position: absolute;
		display: flex;
		align-items: stretch;
		width: max-content;
		max-width: 520px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 3px;
		overflow: hidden;
	}
	.gnode.open {
		border-color: var(--edge-jump);
	}
	.gnode.cursor {
		border-color: var(--accent);
	}
	/* An external or thunk target is a wall: nothing under it is this binary. */
	.gnode.ext .nm {
		color: var(--ec-ucall);
	}
	.gnode.recursive .nm {
		color: var(--ec-trap);
	}
	.knob {
		width: 20px;
		border: none;
		border-right: 1px solid var(--border-soft);
		background: var(--bg-elev);
		color: var(--fg-dim);
		font-family: var(--mono);
		font-size: 12px;
		padding: 0;
		cursor: pointer;
	}
	.knob:disabled {
		cursor: default;
		opacity: 0.4;
	}
	.label {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1 1 auto;
		min-width: 0;
		border: none;
		background: transparent;
		padding: 4px 8px;
		font-size: 11.5px;
		text-transform: none;
		letter-spacing: 0;
		cursor: pointer;
	}
	.label:hover {
		background: var(--row-hover);
	}
	.nm {
		color: var(--ec-fname);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ad {
		color: var(--ec-offset);
		font-size: 10.5px;
		opacity: 0.8;
	}
	.kids {
		font-size: 10px;
		color: var(--fg-dim);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0 5px;
	}
</style>
