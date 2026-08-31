// Export, with something on screen while it happens.
//
// A plain `<a download>` looks like nothing for as long as the server takes to
// pull the artifacts out of ghidra-rest, so the honest reaction is to click it
// again -- and again, each click a fresh pull. This owns the request instead:
// one at a time, visible while it runs, gone once the file is saved.

import { store } from '$lib/api/store';

export type Phase =
	/** nothing running */
	'idle'
	/** asked; the server is packing (and may be pulling artifacts first) */
	| 'packing'
	/** bytes are arriving */
	| 'downloading'
	/** handed to the browser's downloads */
	| 'saved'
	| 'error';

/** how long the "saved" note stays up before it closes itself */
const LINGER_MS = 1400;

/** object URLs outlive the click; the browser needs the blob until it is written */
const REVOKE_MS = 60_000;

function filenameOf(disposition: string | null): string {
	if (!disposition) return '';
	const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
	return m ? decodeURIComponent(m[1]) : '';
}

class Exporter {
	phase = $state<Phase>('idle');
	/** bytes received so far */
	got = $state(0);
	/** what the server said it would send; 0 when it did not say */
	total = $state(0);
	name = $state('');
	error = $state('');

	#abort: AbortController | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;

	get busy() {
		return this.phase === 'packing' || this.phase === 'downloading';
	}

	get open() {
		return this.phase !== 'idle';
	}

	/** -1 when the length is unknown, so the bar can go indeterminate */
	get pct() {
		if (!this.total) return -1;
		return Math.min(100, Math.round((this.got / this.total) * 100));
	}

	async run(id: string, job?: string) {
		// The whole point: a second click while one is in flight is the user
		// asking louder, not asking for a second copy.
		if (this.busy || !id) return;
		if (this.#timer) clearTimeout(this.#timer);

		this.phase = 'packing';
		this.got = 0;
		this.total = 0;
		this.name = '';
		this.error = '';

		const ac = new AbortController();
		this.#abort = ac;
		try {
			const res = await fetch(store.exportUrl(id, job), { signal: ac.signal });
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

			this.name = filenameOf(res.headers.get('content-disposition')) || `guttex-${id.slice(0, 12)}.zip`;
			this.total = Number(res.headers.get('content-length') ?? 0);
			this.phase = 'downloading';

			const blob = await this.#read(res);
			this.#save(blob, this.name);
			this.phase = 'saved';
			this.#timer = setTimeout(() => {
				if (this.phase === 'saved') this.phase = 'idle';
			}, LINGER_MS);
		} catch (e) {
			if (ac.signal.aborted) {
				this.phase = 'idle';
			} else {
				this.error = e instanceof Error ? e.message : String(e);
				this.phase = 'error';
			}
		} finally {
			this.#abort = null;
		}
	}

	/** stop a running export; a half-written zip is worth nothing */
	cancel() {
		this.#abort?.abort();
	}

	/** close the note by hand -- only when there is nothing to interrupt */
	dismiss() {
		if (!this.busy) this.phase = 'idle';
	}

	async #read(res: Response): Promise<Blob> {
		const body = res.body;
		if (!body) return await res.blob();
		const reader = body.getReader();
		const chunks: BlobPart[] = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value as unknown as BlobPart);
			this.got += value.byteLength;
		}
		return new Blob(chunks, { type: 'application/zip' });
	}

	#save(blob: Blob, name: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.rel = 'noopener';
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
	}
}

export const exporter = new Exporter();
