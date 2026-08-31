<script lang="ts">
	// Level-1 list for the phone UI. Same server-side `?q=` + limit/offset paging
	// as the desktop dock, rendered as touch rows: headline, a strip of facts,
	// and a chevron when the row leads somewhere.
	import { ApiError } from '$lib/api/client';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, normAddr } from '$lib/format';
	import { renames } from '$lib/state/renames.svelte';
	import type { Row } from '$components/columns';
	import type { ListSpec } from './lists';

	let { spec, onpick }: { spec: ListSpec; onpick: (addr: string) => void } = $props();

	// Half the desktop page: a thumb scrolls slower than a wheel, and the rows
	// are twice as tall.
	const PAGE = 100;

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
			const page = await spec.fetch(session.id, {
				q: q || undefined,
				limit: PAGE,
				offset: reset ? 0 : rows.length
			});
			const found = reset ? await withRenamed(page.items) : page.items;
			rows = reset ? found : [...rows, ...found];
			total = page.total + (found.length - page.items.length);
		} catch (e) {
			if (e instanceof ApiError && e.notReady) notReady = true;
			else error = e instanceof Error ? e.message : String(e);
			if (reset) rows = [];
		} finally {
			loading = false;
		}
	}

	/** see ListPanel: the server has never heard of a name you gave something */
	async function withRenamed(items: Row[]): Promise<Row[]> {
		const originals = q ? renames.originalsFor(session.project, q) : [];
		if (!originals.length) return items;
		const seen = new Set(items.map((r) => displayAddr(spec.addr(r))));
		const extra: Row[] = [];
		for (const orig of originals) {
			const page = await spec.fetch(session.id, { q: orig, limit: 20 }).catch(() => null);
			for (const r of page?.items ?? []) {
				const key = displayAddr(spec.addr(r));
				if (seen.has(key)) continue;
				seen.add(key);
				extra.push(r);
			}
		}
		return extra.length ? [...extra, ...items] : items;
	}

	function search(v: string) {
		q = v;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => load(true), 200);
	}

	$effect(() => {
		void session.id;
		void session.job?.status;
		load(true);
	});
</script>

{#if spec.searchable !== false}
	<div class="m-tools">
		<input
			class="mono"
			placeholder="filter"
			value={q}
			oninput={(e) => search((e.currentTarget as HTMLInputElement).value)}
		/>
		<span class="count">{rows.length}/{total}</span>
	</div>
{/if}

<div class="m-scroll">
	{#if notReady}
		<p class="empty">analysis still running</p>
	{:else if error}
		<p class="empty err">{error}</p>
	{:else if rows.length === 0}
		<p class="empty">{loading ? 'loading...' : spec.empty}</p>
	{:else}
		<ul class="m-rows">
			{#each rows as r, i (i)}
				{@const a = spec.addr(r)}
				<li>
					<button
						class="m-row"
						disabled={!a}
						aria-current={a && normAddr(a) === session.addr ? 'true' : undefined}
						onclick={() => a && onpick(a)}
					>
						<span class="main">
							<span class="title {spec.titleCls ?? ''}">{spec.title(r)}</span>
							<span class="sub">
								{#each spec.sub(r) as s, k (k)}<span>{s}</span>{/each}
							</span>
						</span>
						{#if a}<span class="chev" aria-hidden="true">&rsaquo;</span>{/if}
					</button>
				</li>
			{/each}
		</ul>

		{#if rows.length < total}
			<div class="m-more">
				<button disabled={loading} onclick={() => load(false)}>
					{loading ? 'loading...' : `load ${Math.min(PAGE, total - rows.length)} more`}
				</button>
			</div>
		{/if}
	{/if}
</div>
