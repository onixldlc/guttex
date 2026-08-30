<script lang="ts">
	// Control-flow graph for the selected function: the same listing as the
	// disassembly tab, cut into basic blocks and laid out downward, with the two
	// sides of every conditional drawn in green and red the way Ghidra and
	// Cutter draw them.
	import { untrack } from 'svelte';
	import { api, ApiError } from '$lib/api/client';
	import type { DisasmListing } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, normAddr } from '$lib/format';
	import { mnemonicClass, tokenizeAsm } from '$lib/asmtok';
	import { buildCfg } from '$lib/graph/cfg';
	import { layered, type Layout } from '$lib/graph/layout';
	import { Measured } from '$lib/graph/measure.svelte';
	import GraphCanvas from './GraphCanvas.svelte';

	let data = $state<DisasmListing | null>(null);
	let loading = $state(false);
	let error = $state('');
	let canvas = $state<GraphCanvas | null>(null);

	$effect(() => {
		const id = session.id;
		const addr = session.addr;
		if (!id || !addr) {
			data = null;
			return;
		}
		let stale = false;
		loading = true;
		error = '';
		api
			.disasm(id, addr)
			.then((d) => {
				if (!stale) data = d;
			})
			.catch((e) => {
				if (stale) return;
				data = null;
				error =
					e instanceof ApiError && e.notReady
						? 'analysis still running'
						: e instanceof Error
							? e.message
							: String(e);
			})
			.finally(() => {
				if (!stale) loading = false;
			});
		return () => {
			stale = true;
		};
	});

	let cfg = $derived(buildCfg(data?.instructions));

	// Blocks are sized by the browser, not guessed: the layout runs on what the
	// monospace text actually measured, so nothing overlaps at any font size.
	const measured = new Measured();
	const reg = measured.node;

	let layout = $derived.by((): Layout | null => {
		if (!cfg) return null;
		return layered(
			cfg.blocks.map((b) => ({ id: b.id, ...(measured.sizes[b.id] ?? { w: 320, h: 90 }) })),
			cfg.edges,
			// Cutter's own block spacing; the edge columns add their own room.
			{ root: cfg.entry, rankGap: 40, nodeGap: 20 }
		);
	});

	// A fresh function starts framed; panning after that is the user's business.
	let framed = '';
	$effect(() => {
		const l = layout;
		const key = `${session.id}:${data?.address ?? ''}:${cfg?.blocks.length ?? 0}`;
		// wait for real sizes -- fitting the placeholder layout frames nothing
		if (!l || !cfg || !measured.ready || framed === key) return;
		framed = key;
		untrack(() => canvas?.fit());
	});

	function poly(points: [number, number][]): string {
		return points.map(([x, y]) => `${x},${y}`).join(' ');
	}

	/** A jump inside the function moves the view; anything else is a real
	    navigation, so it goes through the session like every other address. */
	function go(target: string) {
		const t = normAddr(target);
		const node = layout?.nodes.get(t);
		if (node) canvas?.focus(node.x, node.y, node.w, node.h);
		else session.select(t, 'graph');
	}
</script>

{#snippet ops(text: string | undefined)}{#each tokenizeAsm(text) as tok, k (k)}<span class={tok.c}
			>{tok.t}</span
		>{/each}{/snippet}

<div class="wrap">
	<div class="sub">
		{#if data && cfg}
			<span class="mono name">{data.name}</span>
			<span class="addr">{displayAddr(data.address)}</span>
			<span class="dim">{cfg.blocks.length} blocks / {data.count} instructions</span>
			{#if data.truncated}<span class="err">truncated</span>{/if}
		{:else}
			<span class="dim">pick a function in the left dock</span>
		{/if}
	</div>

	{#if loading}
		<p class="empty">reading listing...</p>
	{:else if error}
		<p class="empty err">{error}</p>
	{:else if cfg && layout}
		<GraphCanvas bind:this={canvas} width={layout.width} height={layout.height}>
			{#snippet children()}
				<svg class="edges" width={layout.width} height={layout.height} aria-hidden="true">
					<defs>
						{#each ['true', 'false', 'jump', 'next'] as k (k)}
							<marker
								id="arrow-{k}"
								viewBox="0 0 8 8"
								refX="7"
								refY="4"
								markerWidth="7"
								markerHeight="7"
								orient="auto-start-reverse"
							>
								<path d="M0,0 L8,4 L0,8 z" class="head {k}" />
							</marker>
						{/each}
					</defs>
					{#each layout.routes as r, i (i)}
						<polyline
							class="edge {r.kind ?? 'next'}"
							class:back={r.back}
							points={poly(r.points)}
							marker-end="url(#arrow-{r.kind ?? 'next'})"
						/>
					{/each}
				</svg>

				{#each cfg.blocks as b (b.id)}
					{@const p = layout.nodes.get(b.id)}
					<div
						class="gnode"
						class:entry={b.id === cfg.entry}
						class:cursor={b.id === normAddr(session.addr)}
						style:left="{p?.x ?? 0}px"
						style:top="{p?.y ?? 0}px"
						use:reg={b.id}
						data-addr={b.id}
					>
						<div class="head mono">
							{displayAddr(b.id)}
							{#if b.id === cfg.entry}<span class="tag">entry</span>{/if}
							{#if b.unresolved}<span class="tag warn">indirect</span>{/if}
						</div>
						<table class="asm">
							<tbody>
								{#each b.instructions as ins (ins.address)}
									<tr data-addr={ins.address}>
										<td class="a">{displayAddr(ins.address)}</td>
										<td class="m {mnemonicClass(ins)}">{ins.mnemonic}</td>
										<td class="o">
											{#if ins.flow}
												<button
													class="target"
													data-addr={ins.flow}
													onclick={() => go(ins.flow!)}
												>
													{@render ops(ins.operands)}
												</button>
											{:else}
												{@render ops(ins.operands)}
											{/if}
										</td>
										<td class="c">{ins.comment ? '; ' + ins.comment : ''}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/each}
			{/snippet}
		</GraphCanvas>
	{:else if session.addr}
		<p class="empty">no instructions here -- external, a thunk, or a data address</p>
	{:else}
		<p class="empty">nothing selected</p>
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
	.name {
		color: var(--ec-fname);
	}

	.edges {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.edge {
		fill: none;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.edge.true {
		stroke: var(--edge-true);
	}
	.edge.false {
		stroke: var(--edge-false);
	}
	.edge.jump {
		stroke: var(--edge-jump);
	}
	.edge.next {
		stroke: var(--edge-next);
	}
	/* A loop reads as a loop at a glance rather than by following it round. */
	.edge.back {
		stroke-dasharray: 5 3;
	}
	.head.true {
		fill: var(--edge-true);
	}
	.head.false {
		fill: var(--edge-false);
	}
	.head.jump {
		fill: var(--edge-jump);
	}
	.head.next {
		fill: var(--edge-next);
	}

	.gnode {
		position: absolute;
		width: max-content;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 3px;
		box-shadow: 0 2px 10px rgb(0 0 0 / 35%);
	}
	.gnode.entry {
		border-color: var(--edge-true);
	}
	.gnode.cursor {
		border-color: var(--accent);
	}
	.gnode .head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		font-size: 11px;
		color: var(--ec-offset);
		background: var(--bg-elev);
		border-bottom: 1px solid var(--border-soft);
	}
	.tag {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-dim);
		border: 1px solid var(--border);
		border-radius: 2px;
		padding: 0 3px;
	}
	.tag.warn {
		color: var(--ec-trap);
		border-color: var(--ec-trap);
	}

	table.asm {
		border-collapse: collapse;
		font-family: var(--mono);
		font-size: 11.5px;
		line-height: 1.45;
		padding: 2px 0;
	}
	table.asm td {
		padding: 0 8px 0 0;
		white-space: pre;
		vertical-align: top;
	}
	table.asm tr:hover {
		background: var(--row-hover);
	}
	.a {
		color: var(--ec-offset);
		padding-left: 8px !important;
		opacity: 0.75;
	}
	.m {
		color: var(--ec-mov);
	}
	.m.call {
		color: var(--ec-call);
		font-weight: 600;
	}
	.m.ucall {
		color: var(--ec-ucall);
		font-weight: 600;
	}
	.m.jmp {
		color: var(--ec-jmp);
	}
	.m.cjmp {
		color: var(--ec-cjmp);
	}
	.m.ujmp {
		color: var(--ec-ujmp);
	}
	.m.ret {
		color: var(--ec-ret);
	}
	.m.trap {
		color: var(--ec-trap);
		font-weight: 600;
	}
	.m.swi {
		color: var(--ec-swi);
	}
	.m.math {
		color: var(--ec-math);
	}
	.m.bin {
		color: var(--ec-bin);
	}
	.m.cmp {
		color: var(--ec-cmp);
	}
	.m.push {
		color: var(--ec-push);
	}
	.m.pop {
		color: var(--ec-pop);
	}
	.m.nop {
		color: var(--ec-nop);
	}
	.o {
		color: var(--ec-mov);
	}
	.o .reg {
		color: var(--ec-reg);
	}
	.o .num {
		color: var(--ec-num);
	}
	.o .flag {
		color: var(--ec-flag);
	}
	.o .str {
		color: var(--ec-num);
	}
	.o .size,
	.o .punct {
		color: var(--ec-other);
	}
	.o .plain {
		color: var(--ec-mov);
	}
	.c {
		color: var(--ec-comment);
	}
	button.target {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		color: var(--ec-flag);
		text-decoration: underline dotted;
		cursor: pointer;
	}
	button.target .reg,
	button.target .num,
	button.target .flag,
	button.target .size,
	button.target .punct,
	button.target .plain,
	button.target .str {
		color: inherit;
	}
	button.target:hover {
		color: var(--accent);
		background: transparent;
	}
</style>
