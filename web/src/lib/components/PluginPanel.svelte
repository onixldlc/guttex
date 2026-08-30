<script lang="ts">
	// Hosts one plugin panel in the centre view. The plugin owns the DOM inside
	// `el` and nothing else; guttex re-mounts it when the tab, the plugin or the
	// open job changes, and always runs the disposer it returned.
	import { plugins } from '$lib/plugins/host.svelte';
	import { session } from '$lib/state/session.svelte';

	let { tab }: { tab: string } = $props();

	let el = $state<HTMLDivElement | null>(null);
	let error = $state('');

	let entry = $derived(plugins.panels.find((p) => p.key === tab));

	$effect(() => {
		const e = entry;
		const node = el;
		session.id; // remount when a different binary is opened
		if (!e?.plugin.manifest || !node) return;

		let disposer: (() => void) | null = null;
		let dropped = false;
		error = '';
		node.replaceChildren();

		(async () => {
			try {
				const d = await e.spec.mount(node, plugins.context(e.plugin.manifest!.id));
				if (dropped) {
					if (typeof d === 'function') d();
					return;
				}
				disposer = typeof d === 'function' ? d : null;
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
			}
		})();

		return () => {
			dropped = true;
			try {
				disposer?.();
			} catch (err) {
				console.error('[guttex] plugin panel disposer threw', err);
			}
			node.replaceChildren();
		};
	});
</script>

<div class="panel-body plugin-body">
	{#if !entry}
		<p class="empty">that panel's plugin is not enabled</p>
	{:else}
		{#if error}<p class="err line">{error}</p>{/if}
		<div class="mount" bind:this={el}></div>
	{/if}
</div>

<style>
	.plugin-body {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.mount {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 10px;
	}
	.line {
		margin: 0;
		padding: 8px 10px;
		font-family: var(--mono);
		font-size: 12px;
		border-bottom: 1px solid var(--border);
	}
</style>
