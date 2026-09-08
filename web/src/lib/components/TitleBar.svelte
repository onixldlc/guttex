<script lang="ts">
	import { api } from '$lib/api/client';
	import { session } from '$lib/state/session.svelte';
	import { progress } from '$lib/state/progress.svelte';
	import { displayAddr, fmtBytes, shortId } from '$lib/format';
	import { dismissable } from '$lib/actions/dismissable';
	import { groupedFor, type Command } from '$lib/commands';

	let jump = $state('');

	// The brand is the menu. Export and Console used to be their own buttons;
	// on a narrow window they were the first things pushed off the edge, so
	// everything that is not about the current address now lives under one
	// trigger that is always there anyway.
	//
	// What it offers comes from `$lib/commands`. The layout is this file's:
	// a command that belongs to a group expands in place rather than flying out
	// a submenu, because two more rows are cheaper to hit (and possible on
	// touch) than a nested hover target. One group is open at a time.
	let menuOpen = $state(false);
	let openGroup = $state('');

	// A group with nothing applicable in it is not drawn at all -- `when` has
	// already dropped its rows -- so the menu shrinks instead of filling up with
	// things that would do nothing.
	const groups = $derived(menuOpen ? groupedFor('menu') : []);

	function close() {
		menuOpen = false;
		openGroup = '';
	}

	function run(c: Command) {
		close();
		c.run({ target: null });
	}

	const busy = (group: Command[]) => group.some((c) => c.busy?.());

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
	<div class="menuwrap" use:dismissable={{ onclose: close, enabled: menuOpen }}>
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
				{#each groups as group (group[0].group ?? group[0].id)}
					{@const name = group[0].group}
					{#if name}
						<li>
							<button
								class="flat item"
								role="menuitem"
								aria-expanded={openGroup === name}
								disabled={busy(group)}
								onclick={() => (openGroup = openGroup === name ? '' : name)}
							>
								{busy(group) ? `${name}...` : name}<span class="caret" aria-hidden="true"
									>{openGroup === name ? '▾' : '▸'}</span
								>
							</button>
							{#if openGroup === name}
								<ul class="submenu">
									{#each group as c (c.id)}
										<li>
											<button class="flat item sub" role="menuitem" onclick={() => run(c)}>
												{c.label({ target: null })}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{:else}
						{#each group as c (c.id)}
							<li>
								<button
									class="flat item"
									role="menuitem"
									class:on={c.id === 'console' && session.consoleOpen}
									disabled={c.busy?.()}
									onclick={() => run(c)}
								>
									{c.label({ target: null })}
								</button>
							</li>
						{/each}
					{/if}
				{/each}
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
