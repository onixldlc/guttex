<script lang="ts">
	import { api } from '$lib/api/client';
	import { session } from '$lib/state/session.svelte';
	import { exporter } from '$lib/state/exporter.svelte';
	import { progress } from '$lib/state/progress.svelte';
	import { renames } from '$lib/state/renames.svelte';
	import { displayAddr, fmtBytes, shortId } from '$lib/format';

	let jump = $state('');

	// The brand is the menu. Export and Console used to be their own buttons;
	// on a narrow window they were the first things pushed off the edge, so
	// everything that is not about the current address now lives under one
	// trigger that is always there anyway.
	let menuOpen = $state(false);
	// "export binary" expands in place rather than flying out a submenu:
	// two more rows are cheaper to hit (and possible on touch) than a nested
	// hover target.
	let binOpen = $state(false);
	let box = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (box && !box.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	});

	function close() {
		menuOpen = false;
		binOpen = false;
	}

	function exportProject() {
		close();
		exporter.run(session.project, session.id);
	}

	function exportBinary(variant: 'original' | 'patched') {
		close();
		exporter.runBinary(session.project, variant, session.id, session.summary?.image_base);
	}

	function toggleConsole() {
		close();
		session.consoleOpen = !session.consoleOpen;
		if (session.consoleOpen) session.refreshLog();
	}

	const patchCount = $derived(session.project ? renames.patchCount(session.project) : 0);

	async function go(e: SubmitEvent) {
		e.preventDefault();
		if (!jump.trim()) return;
		await session.select(jump, 'decompiler');
		jump = '';
	}

	async function cancel() {
		try {
			session.job = await api.cancelJob(session.id);
		} catch (e) {
			session.error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<header class="bar">
	<div class="menuwrap" bind:this={box}>
		<button
			class="brand"
			aria-expanded={menuOpen}
			aria-haspopup="menu"
			onclick={() => (menuOpen ? close() : (menuOpen = true))}
		>
			guttex<span class="caret" aria-hidden="true">▾</span>
		</button>
		{#if menuOpen}
			<ul class="menu" role="menu">
				<li><a class="flat item" role="menuitem" href="/" onclick={close}>home</a></li>
				<li>
					<button
						class="flat item"
						role="menuitem"
						disabled={!session.project || exporter.busy}
						title="the whole project as one file: names, patches, metadata and the analysis artifacts"
						onclick={exportProject}
					>
						{exporter.busy ? 'exporting...' : 'export project'}
					</button>
				</li>
				<li>
					<button
						class="flat item"
						role="menuitem"
						aria-expanded={binOpen}
						disabled={!session.project || exporter.busy}
						onclick={() => (binOpen = !binOpen)}
					>
						export binary<span class="caret" aria-hidden="true">{binOpen ? '▾' : '▸'}</span>
					</button>
					{#if binOpen}
						<ul class="submenu">
							<li>
								<button
									class="flat item sub"
									role="menuitem"
									title="the binary exactly as it was submitted"
									onclick={() => exportBinary('original')}
								>
									original
								</button>
							</li>
							<li>
								<button
									class="flat item sub"
									role="menuitem"
									disabled={!patchCount}
									title="a copy of the binary with this project's byte patches applied"
									onclick={() => exportBinary('patched')}
								>
									current{patchCount ? ` (${patchCount} patch${patchCount === 1 ? '' : 'es'})` : ' (no patches)'}
								</button>
							</li>
						</ul>
					{/if}
				</li>
				<li>
					<button class="flat item" role="menuitem" class:on={session.consoleOpen} onclick={toggleConsole}>
						console
					</button>
				</li>
			</ul>
		{/if}
	</div>

	<span class="file" title={session.title}>{session.title}</span>

	{#if session.job}
		<span class="badge {session.job.status}">{session.job.status}</span>
	{/if}

	{#if session.summary}
		<span class="meta">
		<span class="badge">{session.summary.processor}</span>
		<span class="badge">{session.summary.address_size}-bit</span>
		<span class="badge">{session.summary.endian}</span>
		<span class="badge" title={session.summary.executable_format}>
			{(session.summary.executable_format ?? '').split(' ')[0]}
		</span>
		<span class="badge" title="image base">{displayAddr(session.summary.image_base)}</span>
		</span>
	{:else if session.job}
		<span class="badge">{fmtBytes(session.job.size)}</span>
	{/if}

	<span class="spacer"></span>

	<form onsubmit={go}>
		<input
			class="mono"
			size="16"
			bind:value={jump}
			placeholder="seek 0x001040d0"
			aria-label="seek to address"
		/>
	</form>

	{#if session.job?.status === 'queued' || session.job?.status === 'running'}
		<span class="badge running" title="what analyzeHeadless is doing right now"
			>{progress.line(session.id)}</span
		>
		<button class="flat" onclick={cancel}>Cancel</button>
	{/if}
	<span class="jid mono" title={session.id}>{shortId(session.id)}</span>
</header>

<style>
	.bar {
		display: flex;
		overflow: visible;
		align-items: center;
		gap: 8px;
		height: 38px;
		flex: 0 0 38px;
		padding: 0 10px;
		background: var(--bg-head);
		border-bottom: 1px solid var(--border);
	}
	.menuwrap {
		position: relative;
		display: flex;
		align-self: stretch;
		align-items: center;
		padding-right: 6px;
		border-right: 1px solid var(--border);
	}
	.brand {
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--fg);
		background: none;
		border: 0;
		padding: 4px 2px;
		cursor: pointer;
		font-size: inherit;
		font-family: inherit;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.brand:hover,
	.brand[aria-expanded='true'] {
		color: var(--accent);
	}
	.caret {
		font-size: 9px;
		color: var(--fg-faint);
	}
	.menu,
	.submenu {
		list-style: none;
		margin: 0;
		padding: 4px;
	}
	.menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 60;
		min-width: 180px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 45%);
	}
	.submenu {
		padding: 0 0 2px;
	}
	.item {
		width: 100%;
		justify-content: flex-start;
		text-align: left;
		text-transform: none;
		letter-spacing: 0;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	a.item {
		color: var(--fg);
		padding: 3px 8px;
	}
	a.item:hover {
		text-decoration: none;
		background: var(--bg-panel);
	}
	.item.sub {
		padding-left: 22px;
	}
	.item .caret {
		margin-left: auto;
	}
	.file {
		font-family: var(--mono);
		font-size: 12px;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.jid {
		color: var(--fg-faint);
	}
	button.on {
		background: var(--bg-elev);
		border-color: var(--accent-dim);
		color: var(--accent);
	}
	form {
		display: contents;
	}
	.meta {
		display: flex;
		gap: 8px;
		min-width: 0;
	}
	/* narrow window: drop the arch badges before the controls get pushed off */
	@media (max-width: 1000px) {
		.meta {
			display: none;
		}
	}
	@media (max-width: 700px) {
		.file {
			max-width: 140px;
		}
	}
</style>
