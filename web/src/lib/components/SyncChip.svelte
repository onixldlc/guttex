<script lang="ts">
	// What the sync layer is doing, in one word. Click to force a round trip.
	//
	// It is deliberately small and always present: "offline" has to be visible
	// while you keep working, because the work carries on either way and the
	// only thing you need to know is whether the other device has it yet.
	import { sync } from '$lib/state/sync.svelte';
	import { renames } from '$lib/state/renames.svelte';
	import { session } from '$lib/state/session.svelte';
	import { relTime } from '$lib/format';

	let n = $derived(renames.count(session.project));
	let pending = $derived(renames.pending(session.project));

	let label = $derived.by(() => {
		if (sync.state === 'off') return '';
		if (sync.state === 'offline') return 'offline';
		if (sync.state === 'busy') return 'syncing';
		return pending ? 'pending' : 'synced';
	});

	let title = $derived.by(() => {
		const parts = [`${n} rename${n === 1 ? '' : 's'} in this project`];
		if (sync.at) parts.push(`last agreed ${relTime(new Date(sync.at).toISOString())}`);
		if (sync.error) parts.push(sync.error);
		parts.push('click to sync now');
		return parts.join(' — ');
	});
</script>

{#if label}
	<button class="chip {sync.state}" class:pending {title} onclick={() => sync.now()}>
		<span class="dot"></span>{label}{#if n}<b>{n}</b>{/if}
	</button>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 6px;
		height: 16px;
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--fg-dim);
		font-size: 11px;
		font-family: var(--ui);
		line-height: 1;
	}
	.chip:hover:not(:disabled) {
		background: var(--bg-elev);
		border-color: transparent;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ok);
	}
	.chip.busy .dot {
		background: var(--accent);
	}
	.chip.offline .dot {
		background: var(--warn);
	}
	.chip.pending .dot {
		background: var(--warn);
	}
	b {
		font-family: var(--mono);
		color: var(--fg);
		font-weight: 500;
	}
</style>
