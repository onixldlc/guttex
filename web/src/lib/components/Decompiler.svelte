<script lang="ts">
	// Center view: the decompiled C for whatever address is selected. Tokens are
	// rendered as spans -- server text is never injected as HTML.
	import { api, ApiError } from '$lib/api/client';
	import type { Decompiled } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, tokenizeC } from '$lib/format';

	let data = $state<Decompiled | null>(null);
	let loading = $state(false);
	let error = $state('');

	$effect(() => {
		const addr = session.addr;
		const id = session.id;
		if (!id || !addr) {
			data = null;
			return;
		}
		let stale = false;
		loading = true;
		error = '';
		api
			.decompile(id, addr)
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

	let lines = $derived((data?.c ?? '').split('\n'));

	function copy() {
		if (data?.c) navigator.clipboard?.writeText(data.c);
	}
</script>

<div class="wrap">
	<div class="sub">
		{#if data}
			<span class="mono sig">{data.signature || data.name}</span>
			<span class="addr">{displayAddr(data.address)}</span>
			{#if data.ok === false}<span class="err">decompilation failed</span>{/if}
			<span class="spacer"></span>
			<button class="flat" onclick={copy}>copy</button>
		{:else}
			<span class="dim">pick a function in the left dock</span>
		{/if}
	</div>

	<div class="panel-body code">
		{#if loading}
			<p class="empty">decompiling...</p>
		{:else if error}
			<p class="empty err">{error}</p>
		{:else if data?.error}
			<p class="empty err">{data.error}</p>
		{:else if data?.c}
			<pre>{#each lines as line, i (i)}<span class="ln">{String(i + 1).padStart(4, ' ')}</span
					>{#each tokenizeC(line) as tok, j (j)}<span class={tok.c}>{tok.t}</span>{/each}
{/each}</pre>
		{:else if session.addr}
			<p class="empty">no decompiled body for this address</p>
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
	.sig {
		color: var(--syn-fn);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.code {
		background: var(--bg);
	}
	pre {
		margin: 0;
		padding: 8px 10px 30px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.45;
		tab-size: 4;
	}
	.ln {
		display: inline-block;
		width: 4ch;
		margin-right: 14px;
		color: var(--fg-faint);
		user-select: none;
	}
	.key {
		color: var(--syn-key);
	}
	.type {
		color: var(--syn-type);
	}
	.num {
		color: var(--syn-num);
	}
	.str {
		color: var(--syn-str);
	}
	.com {
		color: var(--syn-com);
		font-style: italic;
	}
	.fn {
		color: var(--syn-fn);
	}
	.punct {
		color: var(--syn-punct);
	}
	.id,
	.plain {
		color: var(--fg);
	}
</style>
