<script lang="ts">
	// Left dock: the Cutter list panels, one tab each, all driven by ListPanel.
	import { api } from '$lib/api/client';
	import ListPanel from './ListPanel.svelte';
	import TabStrip from './TabStrip.svelte';
	import type { Tab } from './tabs';
	import {
		addrKey,
		asFetcher,
		numKey,
		str,
		yn,
		type Column,
		type Fetcher,
		type Row
	} from './columns';
	import { displayAddr, fmtBytes } from '$lib/format';

	type Kind = 'functions' | 'strings' | 'symbols' | 'imports' | 'exports' | 'types' | 'memory';
	let kind = $state<Kind>('functions');

	const addrCol: Column = {
		label: 'address',
		get: (r) => displayAddr(str(r.address)),
		sort: (r) => addrKey(r.address),
		cls: 'addr',
		shrink: true
	};

	const specs: Record<
		Kind,
		{ columns: Column[]; fetch: Fetcher; searchable?: boolean; empty: string }
	> = {
		functions: {
			fetch: asFetcher(api.functions),
			empty: 'no functions',
			columns: [
				addrCol,
				{ label: 'name', get: (r) => str(r.name), title: (r) => str(r.signature) },
				{ label: 'size', get: (r) => str(r.size), sort: (r) => numKey(r.size), shrink: true },
				{ label: 'args', get: (r) => str(r.parameter_count), sort: (r) => numKey(r.parameter_count), shrink: true }
			]
		},
		strings: {
			fetch: asFetcher(api.strings),
			empty: 'no strings',
			columns: [
				addrCol,
				{ label: 'value', get: (r) => str(r.value), cls: 'str' },
				{ label: 'len', get: (r) => str(r.length), sort: (r) => numKey(r.length), shrink: true },
				{ label: 'refs', get: (r) => str(r.reference_count), sort: (r) => numKey(r.reference_count), shrink: true }
			]
		},
		symbols: {
			fetch: asFetcher(api.symbols),
			empty: 'no symbols',
			columns: [
				addrCol,
				{ label: 'name', get: (r) => str(r.name), title: (r) => str(r.full_name) },
				{ label: 'type', get: (r) => str(r.type), shrink: true },
				{ label: 'source', get: (r) => str(r.source), shrink: true }
			]
		},
		imports: {
			fetch: asFetcher(api.imports),
			empty: 'no imports',
			columns: [
				{ label: 'library', get: (r) => str(r.library), shrink: true },
				{ label: 'name', get: (r) => str(r.name), title: (r) => str(r.original_name) },
				{
					label: 'addr',
					get: (r) => displayAddr(str(r.address)),
					sort: (r) => addrKey(r.address),
					cls: 'addr',
					shrink: true
				},
				{ label: 'fn', get: (r) => yn(r.is_function), shrink: true }
			]
		},
		exports: {
			fetch: asFetcher(api.exports),
			empty: 'no exports',
			columns: [
				addrCol,
				{ label: 'name', get: (r) => str(r.name) },
				{ label: 'fn', get: (r) => yn(r.is_function), shrink: true }
			]
		},
		types: {
			fetch: asFetcher(api.types),
			empty: 'no types',
			columns: [
				{ label: 'name', get: (r) => str(r.name), title: (r) => str(r.path) },
				{ label: 'kind', get: (r) => str(r.kind), shrink: true },
				{ label: 'size', get: (r) => str(r.size), sort: (r) => numKey(r.size), shrink: true },
				{ label: 'base', get: (r) => str(r.base_type) }
			]
		},
		memory: {
			// /v1/results/{id}/memory is unpaged and returns a bare array; wrap it in
			// a page envelope so ListPanel does not need a special case
			fetch: asFetcher(async (id: string) => {
				const items = await api.memory(id);
				return { total: items.length, count: items.length, limit: items.length, offset: 0, items };
			}),
			searchable: false,
			empty: 'no memory blocks',
			columns: [
				{ label: 'name', get: (r) => str(r.name), shrink: true },
				{
					label: 'start',
					get: (r) => displayAddr(str(r.start)),
					sort: (r) => addrKey(r.start),
					cls: 'addr',
					shrink: true
				},
				{ label: 'size', get: (r) => fmtBytes(Number(r.size)), sort: (r) => numKey(r.size), shrink: true },
				{
					label: 'perm',
					get: (r) => `${r.read ? 'r' : '-'}${r.write ? 'w' : '-'}${r.execute ? 'x' : '-'}`,
					cls: 'addr',
					shrink: true
				},
				{ label: 'type', get: (r) => str(r.type) }
			]
		}
	};

	const tabs: Tab[] = [
		'functions',
		'strings',
		'symbols',
		'imports',
		'exports',
		'types',
		'memory'
	].map((id) => ({ id, label: id }));
	const addrOf = (r: Row) => str(r.address ?? r.start ?? r.thunk_address ?? '');
	let spec = $derived(specs[kind]);
</script>

<div class="panel">
	<div class="panel-head tabs">
		<TabStrip {tabs} bind:active={() => kind, (v) => (kind = v as Kind)} label="result lists" />
	</div>

	{#key kind}
		<ListPanel
			fetcher={spec.fetch}
			columns={spec.columns}
			searchable={spec.searchable ?? true}
			emptyText={spec.empty}
			{addrOf}
		/>
	{/key}
</div>

<style>
	.tabs {
		gap: 0;
		padding: 0;
		/* the overflow menu drops out of this bar, so it must not clip */
		overflow: visible;
	}
	:global(.list td.str) {
		color: var(--syn-str);
	}
</style>
