<script lang="ts">
	// One generic dock body for every result list: functions, strings, symbols,
	// imports, exports, types, memory. Server-side `?q=` + limit/offset paging,
	// so a 40k-symbol binary never lands in the DOM at once.
	import { session } from '$lib/state/session.svelte';
	import { ApiError } from '$lib/api/client';
	import { displayAddr } from '$lib/format';
	import type { Column, Fetcher, Row } from './columns';

	let {
		fetcher,
		columns,
		addrOf = (r: Row) => String(r.address ?? ''),
		searchable = true,
		pageSize = 200,
		emptyText = 'nothing here'
	}: {
		fetcher: Fetcher;
		columns: Column[];
		addrOf?: (r: Row) => string;
		searchable?: boolean;
		pageSize?: number;
		emptyText?: string;
	} = $props();

	let rows = $state<Row[]>([]);
	let total = $state(0);
	let q = $state('');
	let loading = $state(false);
	let notReady = $state(false);
	let error = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function load(reset = true) {
		if (!session.id) return;
		loading = true;
		error = '';
		notReady = false;
		try {
			const page = await fetcher(session.id, {
				q: q || undefined,
				limit: pageSize,
				offset: reset ? 0 : rows.length
			});
			rows = reset ? page.items : [...rows, ...page.items];
			total = page.total;
		} catch (e) {
			if (e instanceof ApiError && e.notReady) notReady = true;
			else error = e instanceof Error ? e.message : String(e);
			if (reset) rows = [];
		} finally {
			loading = false;
		}
	}

	// Sorting is client-side over the rows fetched so far -- ghidra-rest has no
	// sort parameter, and pulling 40k symbols just to order them is worse than
	// ordering the page you are looking at.
	let sortBy = $state('');
	let sortDir = $state<1 | -1>(1);

	function toggleSort(c: Column) {
		if (c.sort === false) return;
		if (sortBy === c.label) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortBy = c.label;
			sortDir = 1;
		}
	}

	let view = $derived.by(() => {
		const c = columns.find((x) => x.label === sortBy);
		if (!c) return rows;
		const key = typeof c.sort === 'function' ? c.sort : (r: Row) => c.get(r);
		return [...rows].sort((a, b) => {
			const x = key(a);
			const y = key(b);
			const d =
				typeof x === 'number' && typeof y === 'number'
					? x - y
					: String(x).localeCompare(String(y), undefined, { numeric: true });
			return d * sortDir;
		});
	});

	function search(v: string) {
		q = v;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => load(true), 180);
	}

	// re-run whenever the job settles or the panel is mounted for a new binary
	$effect(() => {
		void session.id;
		void session.job?.status;
		load(true);
	});
</script>

<div class="wrap">
	{#if searchable}
		<div class="tools">
			<input
				class="mono"
				placeholder="filter"
				value={q}
				oninput={(e) => search((e.currentTarget as HTMLInputElement).value)}
			/>
			<span class="count dim">{rows.length}/{total}</span>
		</div>
	{/if}

	<div class="panel-body">
		{#if notReady}
			<p class="empty">analysis still running</p>
		{:else if error}
			<p class="empty err">{error}</p>
		{:else if rows.length === 0 && !loading}
			<p class="empty">{emptyText}</p>
		{:else}
			<table class="list">
				<thead>
					<tr>
						{#each columns as c (c.label)}
							<th class={c.shrink ? 'shrink' : ''} aria-sort={sortBy === c.label ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
								{#if c.sort === false}
									{c.label}
								{:else}
									<button
										class="sort"
										class:on={sortBy === c.label}
										title="sort by {c.label} (rows loaded so far)"
										onclick={() => toggleSort(c)}
									>
										{c.label}<span class="arrow"
											>{sortBy === c.label ? (sortDir === 1 ? '▲' : '▼') : ''}</span
										>
									</button>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each view as r, i (addrOf(r) + ':' + i)}
						<tr
							aria-selected={!!addrOf(r) && displayAddr(addrOf(r)) === displayAddr(session.addr)}
							ondblclick={() => session.select(addrOf(r), 'decompiler')}
							onclick={() => session.select(addrOf(r))}
						>
							{#each columns as c (c.label)}
								<td class="{c.cls ?? ''} {c.shrink ? 'shrink' : ''}" title={c.title?.(r) ?? c.get(r)}>
									{c.get(r)}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>

			{#if rows.length < total}
				<div class="more">
					<button class="flat" disabled={loading} onclick={() => load(false)}>
						{loading ? 'loading...' : `load ${Math.min(pageSize, total - rows.length)} more`}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1 1 auto;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 6px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.tools input {
		flex: 1 1 auto;
		min-width: 0;
	}
	th :global(button.sort) {
		display: flex;
		align-items: center;
		gap: 3px;
		width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
	}
	th :global(button.sort:hover) {
		color: var(--fg);
		background: transparent;
	}
	th :global(button.sort.on) {
		color: var(--accent);
	}
	th :global(.arrow) {
		font-size: 8px;
	}
	.count {
		font-family: var(--mono);
		font-size: 11px;
		white-space: nowrap;
	}
	.more {
		padding: 6px;
		text-align: center;
	}
</style>
