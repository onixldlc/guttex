<script lang="ts">
	// Left dock: the Cutter list panels, one tab each, all driven by ListPanel.
	//
	// Which lists exist and what a row is come from `$lib/lists`, shared with
	// the phone. What is left here is this screen's layout: a tab strip in a
	// panel head, and a dense sortable table under it.
	import ListPanel from './ListPanel.svelte';
	import TabStrip from './TabStrip.svelte';
	import type { Tab } from './tabs';
	import { LISTS, listById } from '$lib/lists';

	let kind = $state<string>('functions');

	const tabs: Tab[] = LISTS.map((l) => ({ id: l.id, label: l.label }));
	let spec = $derived(listById(kind) ?? LISTS[0]);
</script>

<div class="panel">
	<div class="panel-head tabs">
		<TabStrip {tabs} bind:active={kind} label="result lists" />
	</div>

	{#key kind}
		<ListPanel
			fetcher={spec.fetch}
			columns={spec.columns}
			searchable={spec.searchable ?? true}
			emptyText={spec.empty}
			addrOf={spec.addr}
		/>
	{/key}
</div>

<style>
	.tabs {
		gap: 0;
		padding: 0;
		/* the overflow menu drops out of this bar, so it must not clip */
		overflow: visible;
	}
	:global(.list td.str) {
		color: var(--syn-str);
	}
</style>
