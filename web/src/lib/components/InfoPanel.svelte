<script lang="ts">
	// Center view: the summary.json fields, i.e. Cutter's "Info" / binary header.
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, fmtBytes, fmtDuration, fmtTime } from '$lib/format';

	let s = $derived(session.summary);
	let j = $derived(session.job);

	let fields = $derived(
		s
			? [
					['name', s.name],
					['format', s.executable_format],
					['language', s.language],
					['processor', s.processor],
					['compiler', s.compiler_spec],
					['endian', s.endian],
					['address size', s.address_size ? `${s.address_size} bit` : ''],
					['image base', displayAddr(s.image_base)],
					['range', `${displayAddr(s.min_address)} - ${displayAddr(s.max_address)}`],
					['md5', s.md5],
					['sha256', s.sha256],
					['ghidra', s.ghidra_version],
					['memory exported', fmtBytes(s.memory_bytes_exported)],
					['analysed', fmtTime(s.creation_date)]
				].filter(([, v]) => v)
			: []
	);
</script>

<div class="panel-body pad">
	{#if j}
		<h3>job</h3>
		<table class="kv">
			<tbody>
				<tr><td>id</td><td class="mono">{j.id}</td></tr>
				<tr><td>file</td><td class="mono">{j.filename}</td></tr>
				<tr><td>size</td><td>{fmtBytes(j.size)}</td></tr>
				<tr><td>sha256</td><td class="mono wrap">{j.sha256}</td></tr>
				<tr><td>status</td><td><span class="badge {j.status}">{j.status}</span></td></tr>
				<tr><td>submitted</td><td>{fmtTime(j.created_at)}</td></tr>
				<tr><td>duration</td><td>{fmtDuration(j.duration_ms)}</td></tr>
				{#if j.error}<tr><td>error</td><td class="err">{j.error}</td></tr>{/if}
			</tbody>
		</table>
	{/if}

	{#if s}
		<h3>binary</h3>
		<table class="kv">
			<tbody>
				{#each fields as [k, v] (k)}
					<tr><td>{k}</td><td class="mono wrap">{v}</td></tr>
				{/each}
			</tbody>
		</table>

		{#if s.counts}
			<h3>counts</h3>
			<div class="counts">
				{#each Object.entries(s.counts) as [k, v] (k)}
					<div class="chip"><b>{v}</b><span>{k}</span></div>
				{/each}
			</div>
		{/if}

		{#if s.entry_points?.length}
			<h3>entry points</h3>
			<div class="entries">
				{#each s.entry_points as e (e)}
					<button class="flat addr" onclick={() => session.select(e, 'decompiler')}>
						{displayAddr(e)}
					</button>
				{/each}
			</div>
		{/if}
	{:else if !j}
		<p class="empty">no job loaded</p>
	{/if}
</div>

<style>
	.pad {
		padding: 12px 16px 30px;
		background: var(--bg);
	}
	h3 {
		margin: 18px 0 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg-dim);
		font-weight: 500;
	}
	h3:first-child {
		margin-top: 0;
	}
	table.kv {
		border-collapse: collapse;
		width: 100%;
		max-width: 720px;
	}
	table.kv td {
		padding: 2px 10px 2px 0;
		vertical-align: top;
	}
	table.kv td:first-child {
		color: var(--fg-dim);
		width: 130px;
		white-space: nowrap;
	}
	.wrap {
		word-break: break-all;
	}
	.counts,
	.entries {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: flex;
		gap: 6px;
		align-items: baseline;
		padding: 3px 9px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 3px;
	}
	.chip b {
		font-family: var(--mono);
		color: var(--fg);
	}
	.chip span {
		color: var(--fg-dim);
		font-size: 11px;
	}
</style>
