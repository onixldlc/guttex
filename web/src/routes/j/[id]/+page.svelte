<script lang="ts">
	// The workbench. Cutter's arrangement: list docks left, listing views in the
	// centre, details/xrefs right, console across the bottom.
	import { page } from '$app/state';
	import { session, type CenterTab } from '$lib/state/session.svelte';
	import { sync } from '$lib/state/sync.svelte';
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
	import Progress from '$components/Progress.svelte';
	import StatusBar from '$components/StatusBar.svelte';
	import Splitter from '$components/Splitter.svelte';
	import TabStrip from '$components/TabStrip.svelte';
	import PluginPanel from '$components/PluginPanel.svelte';
	import ActionsMenu from '$components/ActionsMenu.svelte';
	import ContextMenu from '$components/ContextMenu.svelte';
	import RenameDialog from '$components/RenameDialog.svelte';
	import ExportDialog from '$components/ExportDialog.svelte';
	import SignatureDialog from '$components/SignatureDialog.svelte';
	import { signer } from '$lib/state/signature.svelte';
	import { plugins } from '$lib/plugins/host.svelte';
	import type { Tab } from '$components/tabs';
	import { untrack } from 'svelte';
	import { normAddr } from '$lib/format';

	let leftW = $state(340);
	let rightW = $state(300);
	let consoleH = $state(180);

	$effect(() => {
		const id = page.params.id;
		if (!id) return;
		session.open(id);
		// Renames live on the server, keyed by the binary's hash -- which
		// only exists once the job has loaded, so sync watches for it.
		const detach = sync.attach();
		return () => {
			session.stop();
			detach();
		};
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

	// A retype happens inside Ghidra, so the function entry guttex is holding
	// -- its prototype, return type and parameter list -- is stale the moment
	// it lands. Re-read it; the panels that show decompiled text watch
	// `signer.rev` themselves.
	$effect(() => {
		if (!signer.rev || !session.id || !session.addr) return;
		untrack(() => session.show(session.addr));
	});

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

	<!-- Covers the docks and the centre, which have nothing to draw yet, and
	     nothing below: the console dock stays sharp and usable. -->
	{#if session.job && session.job.status !== 'done'}
		<Progress />
	{/if}
</div>

{#if session.consoleOpen}
	<Splitter bind:value={consoleH} min={80} max={600} dir="y" invert />
	<div class="console" style:height="{consoleH}px"><ConsolePanel /></div>
{/if}

<StatusBar />
<ContextMenu />
<RenameDialog />
<ExportDialog />
<SignatureDialog />

<style>
	.body {
		position: relative; /* the analysis window pins to this, not to the page */
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
</style>
