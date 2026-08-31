// Function prototypes, pushed back into Ghidra.
//
// This is the one edit guttex does not own. Renames live here, in the browser
// and in the project store, because a name is guttex's opinion about a binary.
// A prototype is not: retyping changes what the *decompiler* produces, so it
// has to happen inside Ghidra and every view has to be re-read afterwards.
//
// Two consequences shape everything below:
//
//   - It is slow. ghidra-rest re-opens the job's Ghidra project headless, so a
//     retype costs tens of seconds where a rename costs nothing. The dialog
//     has to say so and has to refuse a second one while the first is in
//     flight, or people queue up JVMs by mashing the button.
//   - It can fail on the input. A prototype is C and the C parser is the
//     judge; "cannot parse prototype: ..." is a field error, not a crash.

import { api, ApiError } from '$lib/api/client';
import type { SignatureEntry } from '$lib/api/types';

export type Ask = {
	/** job id -- signatures are per analysis, unlike renames which are per binary */
	job: string;
	/** normalised entry point of the function being retyped */
	addr: string;
	/** name as shown, for the dialog heading */
	name: string;
	/** the prototype the function has right now */
	current: string;
};

class Signer {
	ask = $state<Ask | null>(null);
	/** what the field holds; seeded from `current` when the dialog opens */
	draft = $state('');
	busy = $state(false);
	error = $state('');
	/** how long the last apply took, so the wait stops feeling like a hang */
	tookMs = $state(0);

	/**
	 * Bumped once per applied edit. Views that show decompiled text read it in
	 * their fetch effect, which is what repaints them: the server re-decompiled
	 * the function and its callers, so anything on screen is now stale.
	 */
	rev = $state(0);

	/** false when the job kept no Ghidra project; nothing here can be retyped */
	editable = $state(true);
	/** why not, verbatim from the server, so the UI never has to guess */
	blocked = $state('');
	/** what this program's compiler spec accepts; empty means offer free text */
	conventions = $state<string[]>([]);

	#entries = $state<Record<string, SignatureEntry>>({});
	#loadedFor = '';

	/** the recorded pre-edit prototype, if this function has been retyped */
	originalOf(addr: string): string {
		return this.#entries[addr]?.original ?? '';
	}
	edited(addr: string): boolean {
		return !!this.#entries[addr];
	}
	get count() {
		return Object.keys(this.#entries).length;
	}

	/**
	 * Pull the ledger for a job once. It answers two questions the UI needs
	 * before it can offer anything: may this job be edited at all, and which
	 * functions already carry an edit.
	 */
	async load(job: string) {
		if (!job || this.#loadedFor === job) return;
		this.#loadedFor = job;
		try {
			const r = await api.signatures(job);
			this.editable = r.editable;
			this.blocked = r.editable ? '' : 'this analysis kept no Ghidra project';
			this.conventions = r.calling_conventions ?? [];
			const m: Record<string, SignatureEntry> = {};
			for (const e of r.signature) m[e.address] = e;
			this.#entries = m;
		} catch (e) {
			// An older ghidra-rest has no such route. Treat that as "cannot
			// edit" rather than as an error the user has to dismiss.
			this.#loadedFor = '';
			this.editable = false;
			this.blocked =
				e instanceof ApiError && e.status === 404
					? 'this ghidra-rest is too old to edit signatures'
					: e instanceof Error
						? e.message
						: String(e);
		}
	}

	open(a: Ask) {
		if (this.busy) return;
		this.ask = a;
		this.draft = a.current;
		this.error = '';
		this.tookMs = 0;
		void this.load(a.job);
	}

	close() {
		if (this.busy) return;
		this.ask = null;
		this.error = '';
	}

	async apply(convention = '') {
		const a = this.ask;
		const proto = this.draft.trim();
		if (!a || this.busy || !proto) return;
		if (proto === a.current && !convention.trim()) {
			this.close();
			return;
		}
		this.busy = true;
		this.error = '';
		try {
			const r = await api.setSignature(a.job, a.addr, proto, convention.trim());
			this.tookMs = r.duration_ms;
			this.#entries = {
				...this.#entries,
				[a.addr]: {
					address: a.addr,
					prototype: r.prototype,
					calling_convention: r.calling_convention,
					original: r.original ?? r.before,
					at: r.set_at
				}
			};
			this.rev++;
			this.ask = null;
		} catch (e) {
			this.error = this.#message(e);
		} finally {
			this.busy = false;
		}
	}

	/** Put back what Ghidra said before the first edit. */
	async reset() {
		const a = this.ask;
		if (!a || this.busy || !this.edited(a.addr)) return;
		this.busy = true;
		this.error = '';
		try {
			const r = await api.clearSignature(a.job, a.addr);
			this.tookMs = r.duration_ms;
			const next = { ...this.#entries };
			delete next[a.addr];
			this.#entries = next;
			this.rev++;
			this.ask = null;
		} catch (e) {
			this.error = this.#message(e);
		} finally {
			this.busy = false;
		}
	}

	#message(e: unknown): string {
		if (e instanceof ApiError) {
			// 409 is the "this job kept no project" answer; latch it so the
			// action stops being offered rather than failing once per click.
			if (e.status === 409) {
				this.editable = false;
				this.blocked = e.message;
			}
			return e.message;
		}
		return e instanceof Error ? e.message : String(e);
	}
}

export const signer = new Signer();
