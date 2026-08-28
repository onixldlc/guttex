// Everything the UI knows about the server goes through here. The browser only
// ever talks to same-origin /api -- in dev that is vite's proxy onto
// ghidra-rest, later it is the guttex backend. No credentials in the bundle.

import type {
	Capabilities,
	Decompiled,
	DecompiledIndexEntry,
	DisasmIndexEntry,
	DisasmListing,
	ExportEntry,
	FunctionEntry,
	HexdumpResponse,
	Import,
	Job,
	JobOptions,
	JobsPage,
	MemBlock,
	Page,
	StringEntry,
	SubmitResponse,
	PageQuery,
	Summary,
	Symbol as SymbolEntry,
	TypeEntry,
	XrefsResponse
} from './types';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
	status: number;
	body: unknown;
	constructor(status: number, message: string, body?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.body = body;
	}
	/** 409 = artifacts are not on disk yet; the job has not reached `done`. */
	get notReady() {
		return this.status === 409;
	}
}

export type { PageQuery };

function qs(params: Record<string, string | number | boolean | undefined>): string {
	const u = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== '') u.set(k, String(v));
	}
	const s = u.toString();
	return s ? `?${s}` : '';
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(BASE + path, init);
	} catch (e) {
		throw new ApiError(0, `network error: ${(e as Error).message}`);
	}
	if (res.ok) return res;

	// ghidra-rest errors are {"error": "...", "status": n}; anything else is
	// a proxy or gateway page, so fall back to the raw text.
	const text = await res.text();
	let message = text.slice(0, 400) || res.statusText;
	let body: unknown = text;
	try {
		const parsed = JSON.parse(text);
		body = parsed;
		if (parsed && typeof parsed.error === 'string') message = parsed.error;
	} catch {
		/* not JSON */
	}
	throw new ApiError(res.status, message, body);
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await raw(path, init);
	return (await res.json()) as T;
}

async function text(path: string, init?: RequestInit): Promise<string> {
	const res = await raw(path, init);
	return await res.text();
}

const listOf =
	<T>(kind: string) =>
	(id: string, p: PageQuery = {}) =>
		json<Page<T>>(`/v1/results/${id}/${kind}${qs({ ...p })}`);

export const api = {
	// --- service ---
	health: () => json<{ status: string; [k: string]: unknown }>('/v1/health'),
	version: () => json<{ version: string; [k: string]: unknown }>('/v1/version'),
	capabilities: () => json<Capabilities>('/v1/capabilities'),

	// --- jobs ---
	// note: /v1/jobs names its array `jobs`, the result lists name theirs `items`
	listJobs: (p: PageQuery & { status?: string } = {}) => json<JobsPage>(`/v1/jobs${qs({ ...p })}`),
	getJob: (id: string) => json<Job>(`/v1/jobs/${id}`),
	deleteJob: (id: string) => raw(`/v1/jobs/${id}`, { method: 'DELETE' }).then(() => undefined),
	cancelJob: (id: string) => json<Job>(`/v1/jobs/${id}/cancel`, { method: 'POST' }),
	jobLog: (id: string, tail?: number) => text(`/v1/jobs/${id}/log${qs({ tail })}`),
	inputUrl: (id: string) => `${BASE}/v1/jobs/${id}/input`,
	exportUrl: (id: string) => `${BASE}/v1/jobs/${id}/export`,

	/** multipart submit; `file` is the binary under analysis. `force` skips the
	    sha256 dedup and always starts a fresh job. */
	submit: (file: File, opts: JobOptions & { name?: string; force?: boolean } = {}) => {
		const fd = new FormData();
		fd.append('file', file, file.name);
		for (const [k, v] of Object.entries(opts)) {
			if (v === undefined || v === '') continue;
			fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
		}
		return json<SubmitResponse>('/v1/jobs', { method: 'POST', body: fd });
	},

	// --- results ---
	summary: (id: string) => json<Summary>(`/v1/results/${id}/summary`),
	functions: listOf<FunctionEntry>('functions'),
	strings: listOf<StringEntry>('strings'),
	symbols: listOf<SymbolEntry>('symbols'),
	imports: listOf<Import>('imports'),
	exports: listOf<ExportEntry>('exports'),
	types: listOf<TypeEntry>('types'),
	// unpaged, and a bare array rather than a page envelope
	memory: (id: string) => json<MemBlock[]>(`/v1/results/${id}/memory`),
	fn: (id: string, addr: string) => json<FunctionEntry>(`/v1/results/${id}/function/${addr}`),
	decompile: (id: string, addr: string) =>
		json<Decompiled>(`/v1/results/${id}/function/${addr}/decompile`),
	disasm: (id: string, addr: string) => json<DisasmListing>(`/v1/results/${id}/disasm/${addr}`),
	disasmIndex: (id: string, p: PageQuery = {}) =>
		json<Page<DisasmIndexEntry>>(`/v1/results/${id}/disasm${qs({ ...p })}`),
	decompiledIndex: (id: string, p: PageQuery = {}) =>
		json<Page<DecompiledIndexEntry>>(`/v1/results/${id}/decompiled${qs({ ...p })}`),
	xrefs: (id: string, addr: string) => json<XrefsResponse>(`/v1/results/${id}/xrefs/${addr}`),
	hexdump: (id: string, addr: string, length = 256) =>
		json<HexdumpResponse>(`/v1/results/${id}/hexdump/${addr}${qs({ length })}`)
};

export type Api = typeof api;
