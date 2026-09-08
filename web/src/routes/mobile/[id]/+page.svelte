<script lang="ts">
	// Phone workbench. Two screens instead of three docks: browse a result list,
	// then read one address. `?a=` is what tells them apart, so Android's back
	// button walks out of a function exactly the way it walks back a page --
	// the same trick the desktop route uses for address history.
	//
	// The centre views are the desktop components, unchanged. They all read the
	// shared `session`, so they do not care which front end mounted them.
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { session, type CenterTab } from '$lib/state/session.svelte';
	import { sync } from '$lib/state/sync.svelte';
	import { progress } from '$lib/state/progress.svelte';
	import SyncChip from '$components/SyncChip.svelte';
	import { displayAddr, normAddr, shortId } from '$lib/format';
	import { dispName } from '$lib/state/renames.svelte';
	import { plugins } from '$lib/plugins/host.svelte';
	import Chips from '$lib/mobile/Chips.svelte';
	import MobileList from '$lib/mobile/MobileList.svelte';
	import { LISTS, listById } from '$lib/lists';
	import InfoPanel from '$components/InfoPanel.svelte';
	import PluginPanel from '$components/PluginPanel.svelte';
	import RenameDialog from '$components/RenameDialog.svelte';
	import ExportDialog from '$components/ExportDialog.svelte';
	import SignatureDialog from '$components/SignatureDialog.svelte';
	import { signer } from '$lib/state/signature.svelte';
	import type { Tab } from '$components/tabs';
	import { isCentre, viewsFor } from '$lib/views';
	import { commandsFor, runKey } from '$lib/commands';
	import '$lib/mobile/mobile.css';

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

	/** an address is selected, so we are on the second screen */
	let detail = $derived(!!session.addr);

	// ---- screen 1: the result lists ----
	// `info` is not a list; it rides in this bar because on a phone there is no
	// second dock to put it in.
	let kind = $state<string>('functions');
	const browseTabs: Tab[] = [
		{ id: 'functions', label: 'functions' },
		{ id: 'info', label: 'info' },
		...LISTS.slice(1).map((l) => ({ id: l.id, label: l.label }))
	];
	let list = $derived(listById(kind));

	// ---- screen 2: the listing views ----
	// `details` is the right dock, which has no CenterTab of its own; everything
	// else mirrors `session.tab` so that following a call target from inside a
	// view lands on the tab that view asked for.
	let view = $state<string>('decompiler');
	$effect(() => {
		const t = session.tab;
		untrack(() => (view = t));
	});
	function setView(v: string) {
		view = v;
		// `details` is a tab here and nowhere else, so it is not a CenterTab and
		// must not be written into the session -- the catalogue says which is which.
		if (isCentre(v)) session.tab = v as CenterTab;
	}
	let detailTabs = $derived<Tab[]>([
		...viewsFor('phone').map((v) => ({ id: v.id, label: v.label })),
		...plugins.panels.map((p) => ({ id: p.key, label: p.label }))
	]);

	// Anything the catalogue does not claim is a plugin panel.
	let View = $derived(viewsFor('phone').find((v) => v.id === view)?.component);

	// Selecting an address pushes one history entry, so going back is exactly
	// the hardware back button -- the two must not disagree.
	const back = () => history.back();

	let menu = $state(false);
	let jump = $state('');

	async function seek(e: SubmitEvent) {
		e.preventDefault();
		if (!jump.trim()) return;
		menu = false;
		await session.select(jump, 'decompiler');
		jump = '';
	}
</script>

<svelte:window onkeydown={runKey} />

<div class="m-app">
	<header class="m-bar">
		{#if detail}
			<button class="m-icon" onclick={back} aria-label="back to list">&larr;</button>
		{:else}
			<a class="m-icon" href="/mobile" aria-label="back to jobs">&larr;</a>
		{/if}

		<span class="t">
			<b>
				{detail
					? dispName(session.project, session.addr, session.fn?.name ?? '') ||
						displayAddr(session.addr)
					: session.title}
			</b>
			<small>
				{#if detail}
					{displayAddr(session.addr)}{session.fn?.size ? ` · ${session.fn.size} B` : ''}
				{:else}
					{shortId(session.id)} · {session.job?.status ?? 'loading'}
				{/if}
			</small>
		</span>

		<SyncChip />
		<button
			class="m-icon"
			aria-label="more"
			aria-expanded={menu}
			onclick={() => (menu = !menu)}>&vellip;</button
		>
	</header>

	{#if menu}
		<div class="m-sheet">
			<form onsubmit={seek}>
				<input class="mono" bind:value={jump} placeholder="seek 0x001040d0" aria-label="seek to address" />
				<button class="primary">go</button>
			</form>
			<!-- Same catalogue the desktop menu reads, laid out as a sheet.
			     A command that does not apply right now is not drawn. -->
			<div class="links">
				{#each commandsFor('sheet') as c (c.id)}
					<button
						disabled={c.busy?.()}
						onclick={() => {
							menu = false;
							c.run({ target: null });
						}}
					>
						{c.label({ target: null })}
					</button>
				{/each}
				<a class="btn" href="/j/{session.id}">desktop ui</a>
				<a class="btn" href="/mobile">jobs</a>
			</div>
		</div>
	{/if}

	{#if session.error}
		<p class="empty err">{session.error}</p>
	{:else if session.job && !session.ready}
		<p class="empty">
			{session.job.status === 'queued' || session.job.status === 'running'
				? `${progress.line(session.id)}... results appear when it finishes`
				: `job ${session.job.status}`}
		</p>
		{#if session.job.error}<p class="empty err">{session.job.error}</p>{/if}
	{/if}

	<!-- Screen 1 stays mounted underneath screen 2: coming back out of a
	     function should land on the row you tapped, not at the top of a
	     freshly refetched list. -->
	<div class="m-body" class:m-hide={detail}>
		<Chips tabs={browseTabs} bind:active={kind} label="result lists" />
		{#if list}
			{#key kind}
				<MobileList spec={list} onpick={(a) => session.select(a)} />
			{/key}
		{:else}
			<InfoPanel />
		{/if}
	</div>

	{#if detail}
		<div class="m-body">
			<Chips tabs={detailTabs} bind:active={() => view, setView} label="views" />
			{#if View}
				<View />
			{:else}
				<PluginPanel tab={view as CenterTab} />
			{/if}
		</div>
	{/if}

	<RenameDialog />
	<ExportDialog />
	<SignatureDialog />
</div>
