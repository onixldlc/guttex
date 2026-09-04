<script lang="ts">
	// Center view: the instruction listing for the selected function, straight
	// out of Ghidra's listing via the disasm artifact. Call and jump targets
	// with a single known destination are clickable, so this walks like Cutter's
	// disassembly pane rather than being a wall of text.
	import { untrack } from 'svelte';
	import { api, ApiError } from '$lib/api/client';
	import type { DisasmListing } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr } from '$lib/format';
	import { mnemonicClass, tokenizeAsm } from '$lib/asmtok';
	import { asmSel } from '$lib/state/asmsel.svelte';
	import { asmMark } from '$lib/state/asmmark.svelte';
	import { patchView } from '$lib/state/patchview.svelte';
	import { aliasName, dispName } from '$lib/state/renames.svelte';
	import { book, namedFlow, operandName } from '$lib/state/book.svelte';

	let data = $state<DisasmListing | null>(null);
	let loading = $state(false);
	let error = $state('');
	let showBytes = $state(true);
	// Names on by default: a listing that says `CALL __security_init_cookie`
	// is the point of having an analyser. The toggle is for when you want to
	// read the addresses themselves -- comparing against another tool, mostly.
	let showNames = $state(true);

	// The listing has its own cursor line, like Ghidra's: clicking a row moves
	// it without navigating away. Navigation (a call target, a sidebar row)
	// re-seats it on the new address.
	let cursor = $state('');
	$effect(() => {
		const a = session.addr;
		untrack(() => (cursor = a));
	});

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
				if (stale) return;
				data = d;
				book.learn(id, d.address, d.name);
				selLo = selHi = -1;
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

	// What is actually drawn: Ghidra's listing with the project's patches
	// decoded over it. Every row index below -- the cursor, the selection, the
	// copy -- is an index into this, not into what the server sent.
	const view = $derived(patchView.apply(session.project, data?.instructions ?? []));

	// Instructions the decompiler sent over, if they are about the function on
	// screen. Marks taken in another function are kept but not honoured: walk
	// back to it and they light up again.
	let marked = $derived(asmMark.owns(data?.address));

	// Land on them rather than somewhere in the middle of the listing.
	//
	// Deliberately not `scrollIntoView`: the tab switch, the listing fetch and
	// the first paint all land within a few frames of each other, and a smooth
	// scroll started against a panel whose rows are still being laid out gets
	// clamped straight back to the top -- which is what it did. Wait for the
	// panel to have a height and the row to exist, then set `scrollTop` once.
	let bodyEl = $state<HTMLElement | undefined>();

	function center() {
		let tries = 0;
		const step = () => {
			const box = bodyEl;
			const row = tableEl?.querySelector('tr.marked') as HTMLElement | null;
			if (!box || !row || !box.clientHeight) {
				if (tries++ < 60) requestAnimationFrame(step);
				return;
			}
			const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
			box.scrollTop += delta - Math.max(0, (box.clientHeight - row.offsetHeight) / 2);
		};
		requestAnimationFrame(step);
	}

	$effect(() => {
		const rows = view.lines.length;
		// `addrs` is a fresh array on every send, so asking for the same line
		// twice re-centres instead of doing nothing.
		if (!marked || !rows || !asmMark.addrs.length) return;
		center();
	});

	// Rows the current text selection spans. The browser only paints the glyphs
	// it selected, which looks broken across a multi-line drag, so the row
	// backgrounds are lit to match. A selection inside a single line stays
	// untouched -- that's the case where the exact characters are the point.
	let tableEl: HTMLTableElement | undefined = $state();
	let selLo = $state(-1);
	let selHi = $state(-1);

	function rowAt(node: Node | null): number | null {
		if (!node || !tableEl) return null;
		const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
		const tr = el?.closest('tr[data-i]') as HTMLElement | null;
		if (tr && tableEl.contains(tr)) return Number(tr.dataset.i);
		// An endpoint outside the table means the drag ran off the top or bottom
		// edge; clamp it to whichever end of the listing it sits past.
		const pos = tableEl.compareDocumentPosition(node);
		const rows = view.lines.length;
		if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 0;
		if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return rows - 1;
		return null;
	}

	$effect(() => {
		const read = () => {
			const sel = document.getSelection();
			if (!tableEl || !sel || sel.isCollapsed || sel.rangeCount === 0) {
				selLo = selHi = -1;
				return;
			}
			const a = rowAt(sel.anchorNode);
			const b = rowAt(sel.focusNode);
			if (a === null || b === null || a === b) {
				selLo = selHi = -1; // one line, or not ours: leave it to the browser
				return;
			}
			selLo = Math.min(a, b);
			selHi = Math.max(a, b);
		};
		document.addEventListener('selectionchange', read);
		return () => document.removeEventListener('selectionchange', read);
	});

	// Publish what is lit so the right-click menu can copy it. The menu is a
	// separate, global component -- it has no other way to see the listing.
	$effect(() => {
		asmSel.lines = view.lines;
		asmSel.lo = selLo;
		asmSel.hi = selHi;
		asmSel.bytes = showBytes;
	});
	$effect(() => () => asmSel.clear());
</script>

<!-- One operand token. A hex token that names something known is drawn as that
     name -- the user's if they renamed it, Ghidra's otherwise -- with the
     address it stands for kept on the title, so nothing is actually hidden. -->
{#snippet ops(text: string | undefined, flow?: string)}{#each tokenizeAsm(text) as tok, k (k)}{@const nm =
			showNames ? operandName(session.project, session.id, tok.t, flow) : ''}<span
			class={nm ? 'sym' : tok.c}
			title={nm ? tok.t : null}>{nm || aliasName(session.project, tok.t)}</span
		>{/each}{/snippet}

<div class="wrap">
	<div class="sub">
		{#if data}
			<span class="mono name">{dispName(session.project, data.address, data.name)}</span>
			<span class="addr">{displayAddr(data.address)}</span>
			<span class="dim">{data.count} instructions</span>
			{#if data.truncated}<span class="err">truncated</span>{/if}
			{#if view.hot.size}
				<span
					class="patched"
					title="guttex decoded these rows, not ghidra -- the decompiler and the graphs still show the original bytes"
					>patched</span
				>
			{:else if view.busy}
				<span class="dim">decoding patch...</span>
			{/if}
			{#if view.error}<span class="err">{view.error}</span>{/if}
			<span class="spacer"></span>
			{#if marked}
				<button
					class="flat mark"
					title="clear the marked instructions"
					onclick={() => asmMark.clear()}
					>from {asmMark.label} &times;
				</button>
			{/if}
			<label class="opt"><input type="checkbox" bind:checked={showNames} /> names</label>
			<label class="opt"><input type="checkbox" bind:checked={showBytes} /> bytes</label>
		{:else}
			<span class="dim">pick a function in the left dock</span>
		{/if}
	</div>

	<div class="panel-body code" bind:this={bodyEl}>
		{#if loading}
			<p class="empty">reading listing...</p>
		{:else if error}
			<p class="empty err">{error}</p>
		{:else if view.lines.length}
			<table class="asm" bind:this={tableEl}>
				<tbody>
					{#each view.lines as ins, i (ins.address)}
						<tr
							class:current={ins.address === cursor}
							class:hot={view.hot.has(ins.address)}
							class:marked={marked && asmMark.has(ins.address)}
							class:inrange={i >= selLo && i <= selHi}
							aria-selected={ins.address === cursor}
							data-i={i}
							data-asm={ins.address}
							data-addr={ins.address}
							onclick={() => (cursor = ins.address)}
						>
							<td class="a">{displayAddr(ins.address)}</td>
							{#if showBytes}<td class="b">{ins.bytes ?? ''}</td>{/if}
							<td class="m {mnemonicClass(ins)}">{ins.mnemonic}</td>
							<td class="o">
								{#if ins.flow}
									<button
										class="target"
										data-addr={ins.flow}
										onclick={(e) => {
											e.stopPropagation();
											session.select(ins.flow!, 'disasm');
										}}
									>
										{@render ops(ins.operands, namedFlow(ins))}
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
		{:else if session.addr}
			<p class="empty">no instructions here -- external, a thunk, or a data address</p>
		{:else}
			<p class="empty">nothing selected</p>
		{/if}
	</div>
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
	.opt {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--fg-dim);
	}
	.code {
		background: var(--bg);
	}
	table.asm {
		border-collapse: collapse;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.5;
		width: 100%;
	}
	table.asm td {
		padding: 0 10px 0 0;
		white-space: pre;
		vertical-align: top;
	}
	table.asm tbody tr:hover {
		background: var(--row-hover);
	}
	tr.current,
	tr.current:hover {
		background: var(--bg-elev);
	}
	/* Full-width backing for a multi-line selection. It sits under the browser's
	   own per-glyph highlight, so the selected block reads as whole lines while
	   the copied text is still exactly what was dragged over. */
	table.asm tbody tr.inrange,
	table.asm tbody tr.inrange:hover {
		background: var(--row-range);
	}
	/* Selection tint layered *over* the cursor line, so the line still reads
	   when it falls inside a multi-row selection. */
	table.asm tbody tr.inrange.current {
		background: linear-gradient(var(--row-range), var(--row-range)), var(--bg-elev);
	}
	/* Instructions behind one line of C. Deliberately not the selection blue:
	   this is the decompiler talking, and both can be on screen at once. */
	table.asm tbody tr.marked,
	table.asm tbody tr.marked:hover {
		background: var(--row-mark);
	}
	table.asm tbody tr.marked.current {
		background: linear-gradient(var(--row-mark), var(--row-mark)), var(--bg-elev);
	}
	/* The set is usually contiguous, so a stripe down the gutter reads as one
	   block rather than a run of separately tinted rows. */
	table.asm tbody tr.marked .a {
		box-shadow: inset 2px 0 0 var(--mark-edge);
	}
	.mark {
		color: var(--mark-edge);
	}
	/* A patched row: guttex's own decode of bytes Ghidra never saw. The gutter
	   stripe is the same idea as the marked block -- this row came from
	   somewhere else -- in the accent the hex view already uses for patches. */
	table.asm tbody tr.hot .a {
		box-shadow: inset 2px 0 0 var(--accent);
	}
	table.asm tbody tr.hot .b {
		color: var(--accent);
	}
	.patched {
		color: var(--accent);
		font-size: 11px;
	}
	.a {
		color: var(--ec-offset);
		padding-left: 10px !important;
		width: 1%;
	}
	.b {
		color: var(--ec-b0x00);
		width: 1%;
	}

	/* Mnemonic buckets, coloured by what the instruction *is* -- rizin's `ec`
	   keys, ayu's values. Unrecognised mnemonics keep the `mov` foreground, so
	   an unknown architecture degrades to a plain listing. */
	.m {
		color: var(--ec-mov);
		width: 1%;
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

	/* Operand tokens: `ec reg`, `ec num`, `ec flag`. */
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
	/* A resolved address reads as a function name, so it takes `ec fname` --
	   the same colour the name has everywhere else in the UI. */
	.o .sym {
		color: var(--ec-fname);
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
		white-space: pre-wrap;
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
	/* A branch destination reads as one clickable thing, so the tokens inside
	   it drop their own colours. */
	button.target .reg,
	button.target .num,
	button.target .flag,
	button.target .size,
	button.target .punct,
	button.target .plain,
	button.target .sym,
	button.target .str {
		color: inherit;
	}
	button.target:hover {
		color: var(--accent);
		background: transparent;
	}
</style>
