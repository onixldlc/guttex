<script lang="ts">
	// ctx.notify() lands here. Plugins get a voice in the UI without being handed
	// the UI.
	import { plugins } from '$lib/plugins/host.svelte';
</script>

{#if plugins.notices.length}
	<div class="stack">
		{#each plugins.notices as n (n.id)}
			<div class="note {n.level}">
				<span class="from mono">{n.from}</span>
				<span class="msg">{n.message}</span>
				<button class="flat x" title="dismiss" onclick={() => plugins.dismiss(n.id)}>x</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack {
		position: fixed;
		right: 12px;
		bottom: 34px;
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: min(420px, 60vw);
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 7px 9px;
		font-size: 12px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: 4px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 45%);
	}
	.note.warn {
		border-left-color: var(--warn);
	}
	.note.error {
		border-left-color: var(--err);
	}
	.from {
		font-size: 11px;
		color: var(--fg-dim);
		flex: none;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.msg {
		flex: 1 1 auto;
		min-width: 0;
		word-break: break-word;
	}
	.x {
		flex: none;
		padding: 0 4px;
	}
</style>
