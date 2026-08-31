// How far the binary has got up the wire.
//
// A 240MB submit sat behind the word "uploading..." with no way to tell a slow
// link from a dead one. `api.submit` reports bytes; this turns them into the
// three numbers worth having -- how far, how fast, how much longer -- plus the
// one that answers the real question: how long since anything moved.
//
// Two phases, and the second is the one people misread as a hang. When the
// last byte is sent the server still has to hash the file, dedup it against
// existing jobs and queue it, and on a big binary that is seconds of silence
// *after* the bar hits 100%. It says so rather than sitting at 100%.

import { api } from '$lib/api/client';
import type { JobOptions, SubmitResponse } from '$lib/api/types';

export type UploadPhase = 'idle' | 'sending' | 'hashing';

/** no progress event for this long, while sending, reads as stalled */
const STALL_SEC = 4;

class Upload {
	phase = $state<UploadPhase>('idle');
	name = $state('');
	total = $state(0);
	sent = $state(0);
	/** bytes/sec, smoothed -- the raw per-event rate jitters too much to read */
	rate = $state(0);
	/** seconds since the last progress event; only meaningful while sending */
	quiet = $state(0);

	#abort: AbortController | null = null;
	#tick: ReturnType<typeof setInterval> | null = null;
	#lastAt = 0;
	#lastSent = 0;

	get busy() {
		return this.phase !== 'idle';
	}

	get pct() {
		return this.total ? Math.min(100, Math.round((this.sent / this.total) * 100)) : 0;
	}

	get stalled() {
		return this.phase === 'sending' && this.quiet >= STALL_SEC;
	}

	/** seconds left at the current rate, or -1 when there is nothing to base it on */
	get eta() {
		if (this.phase !== 'sending' || !this.rate || !this.total) return -1;
		return Math.max(0, Math.round((this.total - this.sent) / this.rate));
	}

	/**
	 * Send the file and resolve with the job the server made.
	 *
	 * Throws exactly what `api.submit` throws -- the caller still owns the
	 * error message and the navigation.
	 */
	async run(file: File, opts: JobOptions & { force?: boolean } = {}): Promise<SubmitResponse> {
		this.#reset();
		this.phase = 'sending';
		this.name = file.name;
		this.total = file.size;
		this.#lastAt = Date.now();
		// The clock has to tick on its own: "nothing has happened for 20s" is a
		// fact about the absence of events, so no event will report it.
		this.#tick = setInterval(() => {
			if (this.phase === 'sending') this.quiet = (Date.now() - this.#lastAt) / 1000;
		}, 500);

		this.#abort = new AbortController();
		try {
			return await api.submit(file, opts, {
				signal: this.#abort.signal,
				onProgress: (sent, total) => this.#moved(sent, total)
			});
		} finally {
			this.#reset();
		}
	}

	/** stop an upload that is going nowhere; `run` rejects with "upload canceled" */
	cancel() {
		this.#abort?.abort();
	}

	#moved(sent: number, total: number) {
		const now = Date.now();
		const dt = (now - this.#lastAt) / 1000;
		if (dt > 0.05) {
			const inst = (sent - this.#lastSent) / dt;
			// first sample stands on its own; after that, ease towards it
			this.rate = this.rate ? this.rate * 0.7 + inst * 0.3 : inst;
		}
		this.#lastAt = now;
		this.#lastSent = sent;
		this.quiet = 0;
		this.sent = sent;
		if (total) this.total = total;
		// The bytes are gone; whatever happens next happens on the server.
		if (sent >= this.total) this.phase = 'hashing';
	}

	#reset() {
		if (this.#tick) clearInterval(this.#tick);
		this.#tick = null;
		this.#abort = null;
		this.phase = 'idle';
		this.name = '';
		this.total = 0;
		this.sent = 0;
		this.rate = 0;
		this.quiet = 0;
		this.#lastAt = 0;
		this.#lastSent = 0;
	}
}

export const upload = new Upload();
