<script lang="ts">
	// The workbench. Cutter's arrangement: list docks left, listing views in the
	// centre, details/xrefs right, console across the bottom.
	import { page } from '$app/state';
	import { session, type CenterTab } from '$lib/state/session.svelte';
	import TitleBar from '$components/TitleBar.svelte';
	import SideDock from '$components/SideDock.svelte';
	import XrefsPanel from '$components/XrefsPanel.svelte';
	import Disassembly from '$components/Disassembly.svelte';
	import FunctionGraph from '$components/FunctionGraph.svelte';
	import Decompiler from '$components/Decompiler.svelte';
	import HexView from '$components/HexView.svelte';
	import CallGraph from '$components/CallGraph.svelte';
	import InfoPanel from '$components/InfoPanel.svelte';
	import ConsolePanel from '$components/ConsolePanel.svelte';
	import StatusBar from '$components/StatusBar.svelte';
	import Splitter from '$components/Splitter.svelte';
	import TabStrip from '$components/TabStrip.svelte';
	import PluginPanel from '$components/PluginPanel.svelte';
	import ActionsMenu from '$components/ActionsMenu.svelte';
	import ContextMenu from '$components/ContextMenu.svelte';
	import { plugins } from '$lib/plugins/host.svelte';
	import type { Tab } from '$components/tabs';
	import { untrack } from 'svelte';
	import { normAddr } from '$lib/format';

	let leftW = $state(340);
	let rightW = $state(300);
	let consoleH = $state(180);

	$effect(() => {
		const id = page.params.id;
		if (id) session.open(id);
		return () => session.stop();
	});

	// Selection rides in `?a=`, so the browser's own history is the address
	// history: back/forward, thumb buttons and Alt+Arrow all traverse it.
	$effect(() => {
		const a = normAddr(page.url.searchParams.get('a') ?? '');
		if (!session.id) return;
		untrack(() => {
			if (a !== session.addr) session.show(a);
		});
	});

	$effect(() => plugins.init());

	// Plugin panels are tabs like any other, appended after the built-ins.
	let tabs = $derived<Tab[]>([
		{ id: 'disasm', label: 'disassembly' },
		{ id: 'graph', label: 'graph' },
		{ id: 'decompiler', label: 'decompiler' },
		{ id: 'hex', label: 'hexdump' },
		{ id: 'callgraph', label: 'call graph' },
		{ id: 'info', label: 'info' },
		...plugins.panels.map((p) => ({ id: p.key, label: p.label }))
	]);
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
			<ActionsMenu />
		</div>

		{#if session.tab === 'disasm'}
			<Disassembly />
		{:else if session.tab === 'graph'}
			<FunctionGraph />
		{:else if session.tab === 'callgraph'}
			<CallGraph />
		{:else if session.tab === 'decompiler'}
			<Decompiler />
		{:else if session.tab === 'hex'}
			<HexView />
		{:else if session.tab === 'info'}
			<InfoPanel />
		{:else}
			<PluginPanel tab={session.tab} />
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
<ContextMenu />

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
