<script lang="ts">
	// Landing view: drop a binary, watch the queue, open a finished job.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api/client';
	import type { Capabilities, Job, JobOptions } from '$lib/api/types';
	import { fmtBytes, fmtDuration, relTime, shortId } from '$lib/format';
	import PluginsPanel from '$components/PluginsPanel.svelte';

	let jobs = $state<Job[]>([]);
	let caps = $state<Capabilities | null>(null);
	let error = $state('');
	let busy = $state(false);
	let dragOver = $state(false);
	let showOpts = $state(false);

	let opts = $state<JobOptions & { force?: boolean }>({
		decompile: true,
		decompile_max_funcs: 400,
		decompile_timeout_sec: 60,
		analysis_timeout_sec: 900
	});

	async function refresh() {
		try {
			const page = await api.listJobs({ limit: 100 });
			jobs = page.jobs;
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function submit(files: FileList | null) {
		if (!files?.length) return;
		busy = true;
		error = '';
		try {
			const res = await api.submit(files[0], opts);
			await goto(`/j/${res.job.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function remove(id: string, e: MouseEvent) {
		e.stopPropagation();
		try {
			await api.deleteJob(id);
			jobs = jobs.filter((j) => j.id !== id);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	$effect(() => {
		refresh();
		api
			.capabilities()
			.then((c) => (caps = c))
			.catch(() => {});
		// keep the queue live while anything is in flight
		const t = setInterval(() => {
			if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) refresh();
		}, 2500);
		return () => clearInterval(t);
	});
</script>

<header class="bar">
	<span class="brand">guttex</span>
	<span class="dim">ghidra, without the ghidra ui</span>
	<span class="spacer"></span>
	{#if caps}
		<span class="badge">{caps.service} {caps.version}</span>
		<span class="badge">ghidra {caps.ghidra_version}</span>
	{:else}
		<span class="badge err">backend unreachable</span>
	{/if}
</header>

<main>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="drop"
		class:over={dragOver}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			submit(e.dataTransfer?.files ?? null);
		}}
	>
		<p class="big">{busy ? 'uploading...' : 'drop a binary here'}</p>
		<p class="dim">ELF, PE, Mach-O, raw -- whatever Ghidra's loaders accept</p>
		<label class="btn primary">
			choose file
			<input
				type="file"
				hidden
				disabled={busy}
				onchange={(e) => submit((e.currentTarget as HTMLInputElement).files)}
			/>
		</label>
		<button class="flat" onclick={() => (showOpts = !showOpts)}>
			{showOpts ? 'hide' : 'analysis'} options
		</button>

		{#if showOpts}
			<div class="opts">
				<label><input type="checkbox" bind:checked={opts.decompile} /> decompile</label>
				<label>max funcs <input type="number" bind:value={opts.decompile_max_funcs} min="0" /></label>
				<label>
					decompile timeout <input type="number" bind:value={opts.decompile_timeout_sec} min="1" />s
				</label>
				<label>
					analysis timeout <input type="number" bind:value={opts.analysis_timeout_sec} min="1" />s
				</label>
				<label><input type="checkbox" bind:checked={opts.force} /> force (skip dedup)</label>
				<label>processor <input class="mono" bind:value={opts.processor} placeholder="auto" /></label>
			</div>
		{/if}
	</div>

	{#if error}<p class="err line">{error}</p>{/if}

	<PluginsPanel />

	<section class="panel jobs">
		<div class="panel-head">
			jobs
			<span class="spacer"></span>
			<button class="flat" onclick={refresh}>refresh</button>
		</div>
		<div class="panel-body">
			{#if jobs.length === 0}
				<p class="empty">no jobs yet</p>
			{:else}
				<table class="list">
					<thead>
						<tr>
							<th class="shrink">id</th>
							<th>file</th>
							<th class="shrink">size</th>
							<th class="shrink">status</th>
							<th class="shrink">language</th>
							<th class="shrink">took</th>
							<th class="shrink">when</th>
							<th class="shrink"></th>
						</tr>
					</thead>
					<tbody>
						{#each jobs as j (j.id)}
							<tr onclick={() => goto(`/j/${j.id}`)} style="cursor:pointer">
								<td class="shrink addr">{shortId(j.id)}</td>
								<td title={j.filename}>{j.filename}</td>
								<td class="shrink">{fmtBytes(j.size)}</td>
								<td class="shrink"><span class="badge {j.status}">{j.status}</span></td>
								<td class="shrink dim">{j.language ?? ''}</td>
								<td class="shrink dim">{fmtDuration(j.duration_ms)}</td>
								<td class="shrink dim">{relTime(j.created_at)}</td>
								<td class="shrink">
									<button class="flat" title="delete" onclick={(e) => remove(j.id, e)}>x</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</section>
</main>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 38px;
		flex: 0 0 38px;
		padding: 0 12px;
		background: var(--bg-head);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	main {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		align-items: center;
	}
	.drop {
		width: 100%;
		max-width: 860px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 34px 20px;
		border: 1px dashed var(--border);
		border-radius: 5px;
		background: var(--bg-panel);
	}
	.drop.over {
		border-color: var(--accent);
		background: var(--bg-elev);
	}
	.big {
		margin: 0;
		font-size: 16px;
	}
	.drop p {
		margin: 0;
	}
	.opts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 8px 18px;
		width: 100%;
		margin-top: 10px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		font-size: 12px;
	}
	.opts label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--fg-dim);
	}
	.opts input[type='number'] {
		width: 82px;
	}
	.opts input:not([type]) {
		flex: 1 1 auto;
		min-width: 0;
	}
	.jobs {
		width: 100%;
		max-width: 860px;
		max-height: 60vh;
	}
	.line {
		max-width: 860px;
		width: 100%;
		font-family: var(--mono);
		font-size: 12px;
	}
</style>
