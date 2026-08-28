import type { Page, PageQuery } from '$lib/api/types';

export type Row = Record<string, unknown>;

/** Column spec for ListPanel. `get` returns the already-formatted cell text;
    the panel never guesses at field types. */
export interface Column {
	label: string;
	get: (r: Row) => string;
	cls?: string;
	shrink?: boolean;
	title?: (r: Row) => string;
	/** sort key. Omit to sort on the rendered text; set `false` to disable. */
	sort?: ((r: Row) => string | number) | false;
}

/** hex address -> number, for sorting. Spaced addresses (`external:1`) sort
    after everything numeric rather than parsing to NaN. */
export const addrKey = (v: unknown) => {
	const s = String(v ?? '').replace(/^0x/i, '');
	const n = parseInt(s, 16);
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

export const numKey = (v: unknown) => {
	const n = Number(v);
	return Number.isNaN(n) ? -1 : n;
};

export type Fetcher = (id: string, p: PageQuery) => Promise<Page<Row>>;

/** ListPanel is deliberately untyped over rows -- columns already say how to
    read each field. This is the one place the concrete artifact types are
    widened, instead of a cast at every call site. */
export const asFetcher = <T>(
	f: (id: string, p?: PageQuery) => Promise<Page<T>>
): Fetcher => f as unknown as Fetcher;

export const yn = (v: unknown) => (v ? 'yes' : '');
export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
