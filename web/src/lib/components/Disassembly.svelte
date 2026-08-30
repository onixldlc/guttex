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

	let data = $state<DisasmListing | null>(null);
	let loading = $state(false);
	let error = $state('');
	let showBytes = $state(true);

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
		const rows = data?.instructions?.length ?? 0;
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
		asmSel.lines = data?.instructions ?? [];
		asmSel.lo = selLo;
		asmSel.hi = selHi;
		asmSel.bytes = showBytes;
	});
	$effect(() => () => asmSel.clear());
</script>

{#snippet ops(text: string | undefined)}{#each tokenizeAsm(text) as tok, k (k)}<span class={tok.c}
			>{tok.t}</span
		>{/each}{/snippet}

<div class="wrap">
	<div class="sub">
		{#if data}
			<span class="mono name">{data.name}</span>
			<span class="addr">{displayAddr(data.address)}</span>
			<span class="dim">{data.count} instructions</span>
			{#if data.truncated}<span class="err">truncated</span>{/if}
			<span class="spacer"></span>
			<label class="opt"><input type="checkbox" bind:checked={showBytes} /> bytes</label>
		{:else}
			<span class="dim">pick a function in the left dock</span>
		{/if}
	</div>

	<div class="panel-body code">
		{#if loading}
			<p class="empty">reading listing...</p>
		{:else if error}
			<p class="empty err">{error}</p>
		{:else if data?.instructions?.length}
			<table class="asm" bind:this={tableEl}>
				<tbody>
					{#each data.instructions as ins, i (ins.address)}
						<tr
							class:current={ins.address === cursor}
							class:inrange={i >= selLo && i <= selHi}
							aria-selected={ins.address === cursor}
							data-i={i}
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
	button.target .str {
		color: inherit;
	}
	button.target:hover {
		color: var(--accent);
		background: transparent;
	}
</style>
