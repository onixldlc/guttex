// Keeping two devices in step.
//
// The shape of the problem: you rename things on the desktop, then pick the
// phone up on the train and keep going. Neither device is authoritative and
// both work offline, so this is not a transaction -- it is two documents and a
// merge rule, and the rule is per entry, later edit wins. Whole-document
// last-writer-wins would throw away whichever device pushed second.
//
// It does not hit the server on every keystroke:
//
//   push   debounced ~1.2s after the last edit. The response is the merged
//          document, so one round trip is both push and pull.
//   pull   every 15s while the tab is visible, and immediately when it becomes
//          visible again. `If-None-Match` makes the quiet case a 304.
//   offline  edits stay in localStorage and the pending flag stays set; the
//          next successful tick carries them.
//
// Everything is keyed by `session.project` -- the binary's sha256 -- so the
// same binary on another machine syncs against the same document.

import { untrack } from 'svelte';
import { store } from '$lib/api/store';
import { renames } from '$lib/state/renames.svelte';
import { session } from '$lib/state/session.svelte';

const POLL_MS = 15_000;
const PUSH_MS = 1_200;

export type SyncState = 'off' | 'idle' | 'busy' | 'offline';

class Sync {
	state = $state<SyncState>('off');
	/** last error, shown on the chip's tooltip rather than as a notice */
	error = $state('');
	/** epoch ms of the last agreement with the server */
	at = $state(0);

	private key = '';
	private rev = -1;
	private poll: ReturnType<typeof setInterval> | null = null;
	private push: ReturnType<typeof setTimeout> | null = null;
	private busy = false;

	constructor() {
		renames.onDirty = (job) => {
			if (job === this.key) this.schedule();
		};
	}

	/**
	 * Follow whatever binary the session has open. Routes call this once on
	 * mount; the project key only exists after the job has loaded, which is why
	 * this watches rather than taking an argument.
	 */
	attach(): () => void {
		const stop = $effect.root(() => {
			$effect(() => {
				const key = session.project;
				const job = session.job;
				untrack(() => {
					if (!key) {
						this.halt();
						return;
					}
					if (key !== this.key) this.begin(key);
					// the project card wants the binary's name, and the job id
					// is this machine's handle on it for a later export
					if (job) void store.touch(key, job.filename, job.filename, job.id).catch(() => {});
				});
			});
		});
		return () => {
			stop();
			this.halt();
		};
	}

	private begin(key: string) {
		this.halt();
		this.key = key;
		this.rev = -1;
		this.state = 'idle';
		this.error = '';

		void this.tick();
		this.poll = setInterval(() => {
			if (typeof document !== 'undefined' && document.hidden) return;
			void this.tick();
		}, POLL_MS);
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.onVisible);
		}
	}

	private halt() {
		if (this.poll) clearInterval(this.poll);
		if (this.push) clearTimeout(this.push);
		this.poll = this.push = null;
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.onVisible);
		}
		this.key = '';
		this.state = 'off';
	}

	private onVisible = () => {
		if (!document.hidden) void this.tick();
	};

	private schedule() {
		if (!this.key) return;
		if (this.push) clearTimeout(this.push);
		this.push = setTimeout(() => {
			this.push = null;
			void this.tick();
		}, PUSH_MS);
	}

	/** force a round trip now; the chip is a button for exactly this */
	now() {
		void this.tick();
	}

	private async tick() {
		const key = this.key;
		if (!key || this.busy) return;
		this.busy = true;
		this.state = 'busy';
		try {
			if (renames.pending(key)) {
				const merged = await store.push(key, renames.doc(key));
				renames.markSynced(key, merged);
				this.rev = merged.rev;
			} else {
				const doc = await store.pull(key, this.rev);
				if (doc) {
					renames.mergeRemote(key, doc);
					this.rev = doc.rev;
					// the pull may have shown us that we hold something newer
					if (renames.pending(key)) {
						const merged = await store.push(key, renames.doc(key));
						renames.markSynced(key, merged);
						this.rev = merged.rev;
					}
				}
			}
			this.at = Date.now();
			this.error = '';
			this.state = 'idle';
		} catch (e) {
			// Offline is a normal state, not a failure: the edits are in
			// localStorage and the next tick will carry them.
			this.error = e instanceof Error ? e.message : String(e);
			this.state = 'offline';
		} finally {
			this.busy = false;
		}
	}
}

export const sync = new Sync();
