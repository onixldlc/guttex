<script lang="ts">
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, fmtDuration } from '$lib/format';

	let counts = $derived(session.summary?.counts ?? session.job?.counts ?? {});
	let keys = $derived(['functions', 'strings', 'symbols', 'imports', 'exports'].filter((k) => k in counts));
</script>

<footer class="bar">
	{#if session.error}
		<span class="err">{session.error}</span>
	{:else if session.job && session.job.status !== 'done'}
		<span class="dim">{session.job.status}{session.job.error ? `: ${session.job.error}` : ''}</span>
	{:else}
		{#each keys as k (k)}
			<span class="dim">{k}<b>{counts[k]}</b></span>
		{/each}
	{/if}

	<span class="spacer"></span>
	{#if session.job?.duration_ms}
		<span class="dim">analysis {fmtDuration(session.job.duration_ms)}</span>
	{/if}
	{#if session.addr}
		<span class="addr">{displayAddr(session.addr)}</span>
	{/if}
	<span class="dim">{session.job?.ghidra_version ?? ''}</span>
</footer>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 22px;
		flex: 0 0 22px;
		padding: 0 10px;
		background: var(--bg-head);
		border-top: 1px solid var(--border);
		font-size: 11px;
	}
	b {
		font-family: var(--mono);
		color: var(--fg);
		margin-left: 5px;
		font-weight: 500;
	}
</style>
