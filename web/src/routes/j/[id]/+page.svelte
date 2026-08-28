<script lang="ts">
	// The workbench. Cutter's arrangement: list docks left, listing views in the
	// centre, details/xrefs right, console across the bottom.
	import { page } from '$app/state';
	import { session, type CenterTab } from '$lib/state/session.svelte';
	import TitleBar from '$components/TitleBar.svelte';
	import SideDock from '$components/SideDock.svelte';
	import XrefsPanel from '$components/XrefsPanel.svelte';
	import Disassembly from '$components/Disassembly.svelte';
	import Decompiler from '$components/Decompiler.svelte';
	import HexView from '$components/HexView.svelte';
	import InfoPanel from '$components/InfoPanel.svelte';
	import ConsolePanel from '$components/ConsolePanel.svelte';
	import StatusBar from '$components/StatusBar.svelte';
	import Splitter from '$components/Splitter.svelte';
	import TabStrip from '$components/TabStrip.svelte';
	import type { Tab } from '$components/tabs';

	let leftW = $state(340);
	let rightW = $state(300);
	let consoleH = $state(180);

	$effect(() => {
		const id = page.params.id;
		if (id) session.open(id);
		return () => session.stop();
	});

	const tabs: Tab[] = [
		{ id: 'disasm', label: 'disassembly' },
		{ id: 'decompiler', label: 'decompiler' },
		{ id: 'hex', label: 'hexdump' },
		{ id: 'info', label: 'info' }
	];
</script>

<TitleBar />

<div class="body">
	<div class="dock" style:width="{leftW}px"><SideDock /></div>
	<Splitter bind:value={leftW} min={220} max={720} />

	<div class="center panel">
		<div class="panel-head tabs">
			<TabStrip
				{tabs}
				bind:active={() => session.tab, (v) => (session.tab = v as CenterTab)}
				label="views"
			/>
			{#if session.job && session.job.status !== 'done'}
				<span class="dim note">results appear when analysis finishes</span>
			{/if}
		</div>

		{#if session.tab === 'disasm'}
			<Disassembly />
		{:else if session.tab === 'decompiler'}
			<Decompiler />
		{:else if session.tab === 'hex'}
			<HexView />
		{:else}
			<InfoPanel />
		{/if}
	</div>

	<Splitter bind:value={rightW} min={200} max={640} invert />
	<div class="dock" style:width="{rightW}px"><XrefsPanel /></div>
</div>

{#if session.consoleOpen}
	<Splitter bind:value={consoleH} min={80} max={600} dir="y" invert />
	<div class="console" style:height="{consoleH}px"><ConsolePanel /></div>
{/if}

<StatusBar />

<style>
	.body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		align-items: stretch;
	}
	.dock {
		display: flex;
		min-width: 0;
		flex: none;
	}
	.dock :global(.panel) {
		flex: 1 1 auto;
		border-top: none;
		border-bottom: none;
	}
	.center {
		flex: 1 1 auto;
		min-width: 0;
		border-top: none;
		border-bottom: none;
	}
	.console {
		flex: none;
		display: flex;
		min-height: 0;
	}
	.console :global(.panel) {
		flex: 1 1 auto;
	}
	.tabs {
		gap: 0;
		padding: 0 8px 0 0;
		overflow: visible;
	}
	.note {
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
	}
</style>
