// What each result list looks like on a phone. Same fetchers the desktop dock
// uses (`$components/columns`), but a row is a headline plus a strip of
// secondary facts instead of a column per field -- five columns on a 360px
// screen is a horizontal scrollbar with the useful one hidden behind it.

import { api } from '$lib/api/client';
import { asFetcher, str, type Fetcher, type Row } from '$components/columns';
import { displayAddr, fmtBytes } from '$lib/format';
import { session } from '$lib/state/session.svelte';
import { dispName } from '$lib/state/renames.svelte';

export type Kind = 'functions' | 'strings' | 'symbols' | 'imports' | 'exports' | 'types' | 'memory';

export interface ListSpec {
	fetch: Fetcher;
	/** headline; falls back to the address when the artifact has no name */
	title: (r: Row) => string;
	/** second line, joined with middots. Empty entries are dropped. */
	sub: (r: Row) => string[];
	/** address the row navigates to; '' makes the row unclickable */
	addr: (r: Row) => string;
	/** extra class on the headline, for the string colour */
	titleCls?: string;
	searchable?: boolean;
	empty: string;
}

const keep = (...parts: (string | false | undefined)[]) => parts.filter(Boolean) as string[];
const addr = (r: Row) => str(r.address);

export const LISTS: Record<Kind, ListSpec> = {
	functions: {
		fetch: asFetcher(api.functions),
		empty: 'no functions',
		addr,
		title: (r) => dispName(session.project, str(r.address), str(r.name)) || displayAddr(str(r.address)),
		sub: (r) =>
			keep(
				displayAddr(str(r.address)),
				r.size ? `${r.size} B` : '',
				`${str(r.parameter_count) || 0} args`,
				r.is_thunk ? 'thunk' : '',
				r.is_external ? 'external' : ''
			)
	},
	strings: {
		fetch: asFetcher(api.strings),
		empty: 'no strings',
		addr,
		titleCls: 'str',
		title: (r) => str(r.value),
		sub: (r) =>
			keep(
				displayAddr(str(r.address)),
				r.length ? `${r.length} B` : '',
				r.reference_count ? `${r.reference_count} refs` : ''
			)
	},
	symbols: {
		fetch: asFetcher(api.symbols),
		empty: 'no symbols',
		addr,
		title: (r) => dispName(session.project, str(r.address), str(r.name)),
		sub: (r) => keep(displayAddr(str(r.address)), str(r.type), str(r.source))
	},
	imports: {
		fetch: asFetcher(api.imports),
		empty: 'no imports',
		addr,
		title: (r) => dispName(session.project, str(r.address), str(r.name)),
		sub: (r) =>
			keep(str(r.library), displayAddr(str(r.address)), r.is_function ? 'function' : '')
	},
	exports: {
		fetch: asFetcher(api.exports),
		empty: 'no exports',
		addr,
		title: (r) => dispName(session.project, str(r.address), str(r.name)),
		sub: (r) => keep(displayAddr(str(r.address)), r.is_function ? 'function' : 'data')
	},
	types: {
		fetch: asFetcher(api.types),
		empty: 'no types',
		// a type is not an address; the row reads, it does not navigate
		addr: () => '',
		title: (r) => dispName(session.project, str(r.address), str(r.name)),
		sub: (r) => keep(str(r.kind), r.size ? `${r.size} B` : '', str(r.base_type))
	},
	memory: {
		// /v1/results/{id}/memory is unpaged and returns a bare array; wrap it in
		// a page envelope so the list does not need a special case
		fetch: asFetcher(async (id: string) => {
			const items = await api.memory(id);
			return { total: items.length, count: items.length, limit: items.length, offset: 0, items };
		}),
		searchable: false,
		empty: 'no memory blocks',
		addr: (r) => str(r.start),
		title: (r) => str(r.name),
		sub: (r) =>
			keep(
				displayAddr(str(r.start)),
				fmtBytes(Number(r.size)),
				`${r.read ? 'r' : '-'}${r.write ? 'w' : '-'}${r.execute ? 'x' : '-'}`,
				str(r.type)
			)
	}
};

export const KINDS: Kind[] = [
	'functions',
	'strings',
	'symbols',
	'imports',
	'exports',
	'types',
	'memory'
];
