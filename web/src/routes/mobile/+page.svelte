<script lang="ts">
	// Phone landing: push a binary, watch the queue, open a finished job. Same
	// endpoints as the desktop landing page, one column and no drop zone --
	// there is nothing to drag on a phone, so the file picker is the whole
	// interaction.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api/client';
	import type { Capabilities, Job, JobOptions } from '$lib/api/types';
	import { fmtBytes, relTime, shortId } from '$lib/format';
	import { store } from '$lib/api/store';
	import '$lib/mobile/mobile.css';

	let jobs = $state<Job[]>([]);
	let caps = $state<Capabilities | null>(null);
	let error = $state('');
	let busy = $state(false);
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
			await goto(`/mobile/${res.job.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// The other way in: a project bundle from another guttex. It lands under
	// the binary's sha256, so the phone does not need the desktop's job id.
	let loading = $state(false);
	let loaded = $state('');

	async function load(files: FileList | null) {
		if (!files?.length) return;
		loading = true;
		error = '';
		loaded = '';
		try {
			const res = await store.importBundle(files[0]);
			const job = jobs.find((j) => j.sha256 === res.id);
			if (job) {
				await goto(`/mobile/${job.id}`);
				return;
			}
			loaded = `${res.renames} name${res.renames === 1 ? '' : 's'} loaded. Analyse the same binary here and they attach to it.`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
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
		const t = setInterval(() => {
			if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) refresh();
		}, 2500);
		return () => clearInterval(t);
	});
</script>

<div class="m-app">
	<header class="m-bar">
		<span class="t">
			<b>guttex</b>
			<small>{caps ? `ghidra-rest ${caps.version} · ghidra ${caps.ghidra_version}` : 'backend unreachable'}</small>
		</span>
		<button class="m-icon" aria-label="refresh" onclick={refresh}>&#8635;</button>
	</header>

	<div class="m-scroll">
		<div class="m-pad">
			<div class="m-card">
				<label class="btn primary">
					{busy ? 'uploading...' : 'choose a binary'}
					<input
						type="file"
						hidden
						disabled={busy}
						onchange={(e) => submit((e.currentTarget as HTMLInputElement).files)}
					/>
				</label>
				<span class="dim">ELF, PE, Mach-O, raw -- whatever Ghidra's loaders accept</span>
				<button class="flat" onclick={() => (showOpts = !showOpts)}>
					{showOpts ? 'hide' : 'analysis'} options
				</button>

				{#if showOpts}
					<div class="m-opts">
						<label><span>decompile</span><input type="checkbox" bind:checked={opts.decompile} /></label>
						<label>
							<span>max funcs</span><input type="number" bind:value={opts.decompile_max_funcs} min="0" />
						</label>
						<label>
							<span>decompile timeout</span>
							<input type="number" bind:value={opts.decompile_timeout_sec} min="1" />
						</label>
						<label>
							<span>analysis timeout</span>
							<input type="number" bind:value={opts.analysis_timeout_sec} min="1" />
						</label>
						<label><span>force (skip dedup)</span><input type="checkbox" bind:checked={opts.force} /></label>
					</div>
				{/if}
			</div>

			<div class="m-card">
				<label class="btn">
					{loading ? 'loading...' : 'load a project'}
					<input
						type="file"
						accept=".zip,application/zip"
						hidden
						disabled={loading}
						onchange={(e) => load((e.currentTarget as HTMLInputElement).files)}
					/>
				</label>
				<span class="dim">a .zip exported from any guttex: names, metadata and artifacts</span>
			</div>

			{#if loaded}<p class="dim">{loaded}</p>{/if}
			{#if error}<p class="err mono">{error}</p>{/if}
		</div>

		{#if jobs.length === 0}
			<p class="empty">no jobs yet</p>
		{:else}
			<ul class="m-rows">
				{#each jobs as j (j.id)}
					<li class="m-jobrow">
						<button class="m-row" onclick={() => goto(`/mobile/${j.id}`)}>
							<span class="main">
								<span class="title">{j.filename}</span>
								<span class="sub">
									<span>{shortId(j.id)}</span>
									<span>{fmtBytes(j.size)}</span>
									<span>{relTime(j.created_at)}</span>
									{#if j.language}<span>{j.language}</span>{/if}
								</span>
							</span>
							<span class="badge {j.status}">{j.status}</span>
						</button>
						<button class="m-icon" aria-label="delete job" onclick={(e) => remove(j.id, e)}
							>&times;</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="m-pad">
			<a class="dim" href="/">desktop ui</a>
		</div>
	</div>
</div>
