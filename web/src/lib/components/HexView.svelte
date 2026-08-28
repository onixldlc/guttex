<script lang="ts">
	// Center view: raw bytes around the selected address. ghidra-rest already
	// renders `hexdump -C` style text, so this pane frames it and walks pages.
	import { api, ApiError } from '$lib/api/client';
	import type { HexdumpResponse } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, normAddr } from '$lib/format';

	let length = $state(256);
	let cursor = $state('');
	let data = $state<HexdumpResponse | null>(null);
	let loading = $state(false);
	let error = $state('');

	// follow the dock selection, but keep our own cursor while paging
	$effect(() => {
		const a = session.addr;
		if (a) cursor = a;
	});

	$effect(() => {
		const id = session.id;
		const at = cursor || normAddr(session.summary?.image_base ?? '');
		const len = length;
		if (!id || !at) return;
		let stale = false;
		loading = true;
		error = '';
		api
			.hexdump(id, at, len)
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

	function step(delta: number) {
		const base = parseInt(normAddr(cursor || '0'), 16);
		if (Number.isNaN(base)) return;
		cursor = Math.max(0, base + delta).toString(16);
	}
</script>

<div class="wrap">
	<div class="sub">
		<button class="flat" onclick={() => step(-length)} disabled={!cursor}>&lt;&lt;</button>
		<span class="addr">{displayAddr(data?.address ?? cursor)}</span>
		<button class="flat" onclick={() => step(length)} disabled={!cursor}>&gt;&gt;</button>
		<select bind:value={length}>
			{#each [128, 256, 512, 1024, 4096] as n (n)}
				<option value={n}>{n} B</option>
			{/each}
		</select>
		{#if data?.block}<span class="badge">{data.block}</span>{/if}
		{#if data}<span class="dim mono">{data.length} B</span>{/if}
		<span class="spacer"></span>
		{#if loading}<span class="dim">loading...</span>{/if}
	</div>

	<div class="panel-body code">
		{#if error}
			<p class="empty err">{error}</p>
		{:else if data?.hex}
			<pre>{data.hex}</pre>
		{:else if !cursor}
			<p class="empty">pick an address</p>
		{:else if !loading}
			<p class="empty">no bytes at this address (uninitialised block?)</p>
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
		gap: 8px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.code {
		background: var(--bg);
	}
	pre {
		margin: 0;
		padding: 8px 10px 30px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--fg);
	}
</style>
