// Every result list guttex has, in one place.
//
// A list is three things: where the rows come from, what a row *is*, and how a
// row looks. The first two are the same on every screen. The third is not, and
// this file does not pretend otherwise -- it carries both presentations side by
// side rather than one that bends:
//
//   columns  the desktop dock: a column per field, sortable, dense
//   row      the phone: a headline and a strip of secondary facts
//
// Five columns on a 360px screen is a horizontal scrollbar with the useful one
// hidden behind it, so `MobileList` is a different component with a different
// layout and stays that way. What it stops being is a second list of *which
// lists exist* -- that was `SideDock.specs` and `mobile/lists.ts`, seven kinds
// declared twice, down to a duplicated comment about the memory endpoint.

import { api } from '$lib/api/client';
import {
	addrKey,
	asFetcher,
	numKey,
	str,
	yn,
	type Column,
	type Fetcher,
	type Row
} from '$components/columns';
import { displayAddr, fmtBytes } from '$lib/format';
import { session } from '$lib/state/session.svelte';
import { dispName } from '$lib/state/renames.svelte';

export type ListId =
	| 'functions'
	| 'strings'
	| 'symbols'
	| 'imports'
	| 'exports'
	| 'types'
	| 'memory';

/** how a row reads on a phone: a headline plus facts joined with middots */
export type RowSpec = {
	title: (r: Row) => string;
	/** empty entries are dropped */
	sub: (r: Row) => string[];
	/** extra class on the headline, for the string colour */
	cls?: string;
};

export type ListSpec = {
	id: ListId;
	label: string;

	// ---- the same on every screen ----
	fetch: Fetcher;
	empty: string;
	searchable?: boolean;
	/** the address the row navigates to; '' makes the row unclickable */
	addr: (r: Row) => string;

	// ---- one per screen ----
	columns: Column[];
	row: RowSpec;
};

const keep = (...parts: (string | false | undefined)[]) => parts.filter(Boolean) as string[];
const byAddress = (r: Row) => str(r.address);
const named = (r: Row) => dispName(session.project, str(r.address), str(r.name));

const addrCol: Column = {
	label: 'address',
	get: (r) => displayAddr(str(r.address)),
	sort: (r) => addrKey(r.address),
	cls: 'addr',
	shrink: true
};

export const LISTS: ListSpec[] = [
	{
		id: 'functions',
		label: 'functions',
		fetch: asFetcher(api.functions),
		empty: 'no functions',
		addr: byAddress,
		columns: [
			addrCol,
			{ label: 'name', get: named, title: (r) => str(r.signature) },
			{ label: 'size', get: (r) => str(r.size), sort: (r) => numKey(r.size), shrink: true },
			{
				label: 'args',
				get: (r) => str(r.parameter_count),
				sort: (r) => numKey(r.parameter_count),
				shrink: true
			}
		],
		row: {
			title: (r) => named(r) || displayAddr(str(r.address)),
			sub: (r) =>
				keep(
					displayAddr(str(r.address)),
					r.size ? `${r.size} B` : '',
					`${str(r.parameter_count) || 0} args`,
					r.is_thunk ? 'thunk' : '',
					r.is_external ? 'external' : ''
				)
		}
	},
	{
		id: 'strings',
		label: 'strings',
		fetch: asFetcher(api.strings),
		empty: 'no strings',
		addr: byAddress,
		columns: [
			addrCol,
			{ label: 'value', get: (r) => str(r.value), cls: 'str' },
			{ label: 'len', get: (r) => str(r.length), sort: (r) => numKey(r.length), shrink: true },
			{
				label: 'refs',
				get: (r) => str(r.reference_count),
				sort: (r) => numKey(r.reference_count),
				shrink: true
			}
		],
		row: {
			cls: 'str',
			title: (r) => str(r.value),
			sub: (r) =>
				keep(
					displayAddr(str(r.address)),
					r.length ? `${r.length} B` : '',
					r.reference_count ? `${r.reference_count} refs` : ''
				)
		}
	},
	{
		id: 'symbols',
		label: 'symbols',
		fetch: asFetcher(api.symbols),
		empty: 'no symbols',
		addr: byAddress,
		columns: [
			addrCol,
			{ label: 'name', get: named, title: (r) => str(r.full_name) },
			{ label: 'type', get: (r) => str(r.type), shrink: true },
			{ label: 'source', get: (r) => str(r.source), shrink: true }
		],
		row: {
			title: named,
			sub: (r) => keep(displayAddr(str(r.address)), str(r.type), str(r.source))
		}
	},
	{
		id: 'imports',
		label: 'imports',
		fetch: asFetcher(api.imports),
		empty: 'no imports',
		addr: byAddress,
		columns: [
			{ label: 'library', get: (r) => str(r.library), shrink: true },
			{ label: 'name', get: named, title: (r) => str(r.original_name) },
			{
				label: 'addr',
				get: (r) => displayAddr(str(r.address)),
				sort: (r) => addrKey(r.address),
				cls: 'addr',
				shrink: true
			},
			{ label: 'fn', get: (r) => yn(r.is_function), shrink: true }
		],
		row: {
			title: named,
			sub: (r) => keep(str(r.library), displayAddr(str(r.address)), r.is_function ? 'function' : '')
		}
	},
	{
		id: 'exports',
		label: 'exports',
		fetch: asFetcher(api.exports),
		empty: 'no exports',
		addr: byAddress,
		columns: [
			addrCol,
			{ label: 'name', get: named },
			{ label: 'fn', get: (r) => yn(r.is_function), shrink: true }
		],
		row: {
			title: named,
			sub: (r) => keep(displayAddr(str(r.address)), r.is_function ? 'function' : 'data')
		}
	},
	{
		id: 'types',
		label: 'types',
		fetch: asFetcher(api.types),
		empty: 'no types',
		// A type is not an address -- the artifact carries no `address` field at
		// all -- so the row reads, it does not navigate.
		addr: () => '',
		columns: [
			{ label: 'name', get: (r) => str(r.name), title: (r) => str(r.path) },
			{ label: 'kind', get: (r) => str(r.kind), shrink: true },
			{ label: 'size', get: (r) => str(r.size), sort: (r) => numKey(r.size), shrink: true },
			{ label: 'base', get: (r) => str(r.base_type) }
		],
		row: {
			title: (r) => str(r.name),
			sub: (r) => keep(str(r.kind), r.size ? `${r.size} B` : '', str(r.base_type))
		}
	},
	{
		id: 'memory',
		label: 'memory',
		// /v1/results/{id}/memory is unpaged and returns a bare array; wrap it in
		// a page envelope so neither list needs a special case.
		fetch: asFetcher(async (id: string) => {
			const items = await api.memory(id);
			return { total: items.length, count: items.length, limit: items.length, offset: 0, items };
		}),
		searchable: false,
		empty: 'no memory blocks',
		addr: (r) => str(r.start),
		columns: [
			{ label: 'name', get: (r) => str(r.name), shrink: true },
			{
				label: 'start',
				get: (r) => displayAddr(str(r.start)),
				sort: (r) => addrKey(r.start),
				cls: 'addr',
				shrink: true
			},
			{
				label: 'size',
				get: (r) => fmtBytes(Number(r.size)),
				sort: (r) => numKey(r.size),
				shrink: true
			},
			{
				label: 'perm',
				get: (r) => `${r.read ? 'r' : '-'}${r.write ? 'w' : '-'}${r.execute ? 'x' : '-'}`,
				cls: 'addr',
				shrink: true
			},
			{ label: 'type', get: (r) => str(r.type) }
		],
		row: {
			title: (r) => str(r.name),
			sub: (r) =>
				keep(
					displayAddr(str(r.start)),
					fmtBytes(Number(r.size)),
					`${r.read ? 'r' : '-'}${r.write ? 'w' : '-'}${r.execute ? 'x' : '-'}`,
					str(r.type)
				)
		}
	}
];

export const listById = (id: string): ListSpec | undefined => LISTS.find((l) => l.id === id);
