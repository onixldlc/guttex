// The guttex-owned half of the API: projects and annotations. Same origin,
// same `/api` prefix as ghidra-rest, different owner -- `/api/guttex/*` is
// answered by guttex's own endpoints, everything else is forwarded.

import type { Doc } from '$lib/state/renames.svelte';

const BASE = '/api/guttex/v1';

export type Imported = {
	id: string;
	name: string;
	file: string;
	/** the job the bundle was exported from; may mean nothing on this machine */
	job: string;
	rev: number;
	renames: number;
	archived: boolean;
};

export type ProjectMeta = {
	id: string;
	name: string;
	file?: string;
	created_at: string;
	updated_at: string;
	rev: number;
	renames: number;
	archived?: boolean;
	archive_bytes?: number;
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(BASE + path, init);
	if (!res.ok) {
		let msg = res.statusText;
		try {
			const body = await res.json();
			if (body?.message || body?.error) msg = body.message ?? body.error;
		} catch {
			/* not json */
		}
		throw new Error(`${res.status} ${msg}`);
	}
	return (await res.json()) as T;
}

export type AsmLine = { addr: string; text: string; size: number };

/** what `/asm` answers: bytes, or instructions, or why neither happened */
export type AsmAnswer = {
	ok: boolean;
	error?: string;
	hex?: string;
	bytes?: number;
	lines?: AsmLine[];
	trailing?: number;
};

export type AsmAsk = {
	/** `asm` = assemble `text`, `hex` = disassemble it */
	mode: 'asm' | 'hex';
	text: string;
	/** where the bytes will land -- relative branches depend on it */
	addr?: string;
	language?: string;
	processor?: string;
	bits?: number;
	endian?: 'little' | 'big';
	thumb?: boolean;
};

export const store = {
	health: () => json<{ status: string; projects: string }>('/health'),

	/**
	 * Assemble or disassemble one patch's worth of code. Both directions live
	 * on the server because that is where keystone and capstone are; the editor
	 * calls this on every keystroke to fill its preview box.
	 */
	translate: (ask: AsmAsk) =>
		json<AsmAnswer>('/asm', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(ask)
		}),
	list: () => json<{ count: number; items: ProjectMeta[] }>('/projects'),

	/** create on first open, and keep the binary's name on the project card */
	touch: (id: string, name?: string, file?: string, job?: string) =>
		json<ProjectMeta>(`/projects/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, file, job })
		}),

	/**
	 * Poll. `rev` is what we already have: the server answers 304 and no body
	 * when nothing moved, which is what makes a 15s poll cheap enough to leave
	 * running.
	 */
	async pull(id: string, rev: number): Promise<Doc | null> {
		const res = await fetch(`${BASE}/projects/${id}/annotations`, {
			headers: rev >= 0 ? { 'if-none-match': `"${rev}"` } : {}
		});
		if (res.status === 304) return null;
		if (!res.ok) throw new Error(`pull failed: ${res.status}`);
		return (await res.json()) as Doc;
	},

	/** push and pull in one trip: the response is the merged document */
	push: (id: string, doc: Doc) =>
		json<Doc>(`/projects/${id}/annotations`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(doc)
		}),

	del: (id: string) => fetch(`${BASE}/projects/${id}`, { method: 'DELETE' }).then(() => undefined),

	/**
	 * The whole project as one zip: names, metadata and Ghidra's artifacts.
	 * `job` tells the server which job to pull the artifacts from if they have
	 * not been archived yet.
	 */
	exportUrl: (id: string, job?: string) =>
		`${BASE}/projects/${id}/export${job ? `?job=${encodeURIComponent(job)}` : ''}`,

	/**
	 * The binary itself: `original` as submitted, `patched` with the project's
	 * byte patches applied to a copy on the way out. `base` is Ghidra's image
	 * base, which the server needs to turn patch addresses into file offsets.
	 */
	binaryUrl: (id: string, variant: 'original' | 'patched', job?: string, base?: string) => {
		const q = new URLSearchParams({ variant });
		if (job) q.set('job', job);
		if (base) q.set('base', base.replace(/^0x/i, ''));
		return `${BASE}/projects/${id}/binary?${q}`;
	},

	/**
	 * Take one back. Lands under the binary's hash, so it meets its binary.
	 *
	 * Sent as the raw body rather than a form: no multipart to parse on the
	 * other end, and the file's own content type is something a foreign page
	 * cannot send without a preflight guttex never answers. The origin check
	 * in `hooks.server.ts` covers this request either way.
	 */
	importBundle: (file: File) =>
		json<Imported>('/projects/import', {
			method: 'POST',
			headers: { 'content-type': 'application/zip' },
			body: file
		})
};
