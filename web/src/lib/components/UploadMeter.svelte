<script lang="ts">
	// The upload bar, on both landing pages. Renders nothing when idle, so the
	// call site is one line in the drop zone.
	import { fmtBytes } from '$lib/format';
	import { upload } from '$lib/state/upload.svelte';

	let eta = $derived(upload.eta);
</script>

{#if upload.busy}
	<div class="meter" role="status" aria-live="polite">
		<div class="bar">
			<div class="fill" class:stalled={upload.stalled} style:width="{upload.pct}%"></div>
		</div>

		<p class="line mono">
			{#if upload.phase === 'hashing'}
				<!-- The bytes are all sent. The server is hashing and dedupping,
				     which on a big binary is a few seconds of silence. -->
				sent {fmtBytes(upload.total)} - the server is hashing it
			{:else}
				<span>{fmtBytes(upload.sent)} / {fmtBytes(upload.total)}</span>
				<span class="sep">-</span>
				<span>{upload.pct}%</span>
				{#if upload.rate}
					<span class="sep">-</span>
					<span>{fmtBytes(upload.rate)}/s</span>
				{/if}
				{#if eta >= 0 && !upload.stalled}
					<span class="sep">-</span>
					<span>{eta < 60 ? `${eta}s` : `${Math.floor(eta / 60)}m ${eta % 60}s`} left</span>
				{/if}
				{#if upload.stalled}
					<span class="sep">-</span>
					<span class="warn">stalled {Math.round(upload.quiet)}s</span>
				{/if}
			{/if}
			<button class="flat" onclick={() => upload.cancel()}>cancel</button>
		</p>
	</div>
{/if}

<style>
	.meter {
		width: min(420px, 100%);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.bar {
		height: 4px;
		border-radius: 2px;
		background: var(--bg-input);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s linear;
	}
	.fill.stalled {
		background: var(--warn);
	}
	.line {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 5px;
		margin: 0;
		font-size: 11.5px;
		color: var(--fg-dim);
	}
	.sep {
		color: var(--fg-faint);
	}
	.warn {
		color: var(--warn);
	}
	.line button {
		padding: 1px 6px;
		font-size: 11px;
	}
</style>
