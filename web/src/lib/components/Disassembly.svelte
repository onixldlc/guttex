<script lang="ts">
	// Center view: the instruction listing for the selected function, straight
	// out of Ghidra's listing via the disasm artifact. Call and jump targets
	// with a single known destination are clickable, so this walks like Cutter's
	// disassembly pane rather than being a wall of text.
	import { api, ApiError } from '$lib/api/client';
	import type { DisasmListing } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr } from '$lib/format';

	let data = $state<DisasmListing | null>(null);
	let loading = $state(false);
	let error = $state('');
	let showBytes = $state(true);

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

	function cls(i: { is_call?: boolean; is_jump?: boolean; is_terminal?: boolean }) {
		if (i.is_call) return 'call';
		if (i.is_jump) return 'jump';
		if (i.is_terminal) return 'ret';
		return '';
	}
</script>

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
			<table class="asm">
				<tbody>
					{#each data.instructions as ins (ins.address)}
						<tr class:current={ins.address === session.addr}>
							<td class="a">{displayAddr(ins.address)}</td>
							{#if showBytes}<td class="b">{ins.bytes ?? ''}</td>{/if}
							<td class="m {cls(ins)}">{ins.mnemonic}</td>
							<td class="o">
								{#if ins.flow}
									<button class="target" onclick={() => session.select(ins.flow!, 'disasm')}>
										{ins.operands}
									</button>
								{:else}
									{ins.operands ?? ''}
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
		color: var(--syn-fn);
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
	tr.current {
		background: var(--row-hover);
	}
	.a {
		color: var(--syn-addr);
		padding-left: 10px !important;
		width: 1%;
	}
	.b {
		color: var(--fg-faint);
		width: 1%;
	}
	.m {
		color: var(--fg);
		width: 1%;
	}
	.m.call {
		color: var(--syn-fn);
	}
	.m.jump {
		color: var(--syn-key);
	}
	.m.ret {
		color: var(--err);
	}
	.o {
		color: var(--syn-num);
	}
	.c {
		color: var(--syn-com);
		white-space: pre-wrap;
	}
	button.target {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		color: var(--syn-fn);
		text-decoration: underline dotted;
		cursor: pointer;
	}
	button.target:hover {
		color: var(--accent);
		background: transparent;
	}
</style>
