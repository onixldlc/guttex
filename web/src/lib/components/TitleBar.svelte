<script lang="ts">
	import { api } from '$lib/api/client';
	import { session } from '$lib/state/session.svelte';
	import { exporter } from '$lib/state/exporter.svelte';
	import { displayAddr, fmtBytes, shortId } from '$lib/format';

	let jump = $state('');

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
	<a class="brand" href="/">guttex</a>

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
		<button class="flat" onclick={cancel}>Cancel</button>
	{/if}
	<!-- One file: the names and Ghidra's artifacts together. Two buttons meant
	     pairing two downloads up by hand on the other machine.

	     Not an <a download>: packing can take a while on a project whose
	     artifacts have not been pulled yet, and a link that looks inert gets
	     clicked ten times. `exporter` runs one at a time and says so. -->
	<button
		class="btn"
		onclick={() => exporter.run(session.project, session.id)}
		disabled={exporter.busy}
		title="the whole project as one file: names, metadata and the analysis artifacts"
		>{exporter.busy ? 'Exporting...' : 'Export'}</button
	>
	<button
		class="flat"
		class:on={session.consoleOpen}
		onclick={() => {
			session.consoleOpen = !session.consoleOpen;
			if (session.consoleOpen) session.refreshLog();
		}}>Console</button
	>
	<span class="jid mono" title={session.id}>{shortId(session.id)}</span>
</header>

<style>
	.bar {
		display: flex;
		overflow: hidden;
		align-items: center;
		gap: 8px;
		height: 38px;
		flex: 0 0 38px;
		padding: 0 10px;
		background: var(--bg-head);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--fg);
		padding-right: 6px;
		border-right: 1px solid var(--border);
	}
	.brand:hover {
		color: var(--accent);
		text-decoration: none;
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
