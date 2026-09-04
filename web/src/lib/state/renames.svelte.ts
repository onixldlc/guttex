// Renaming, guttex-side.
//
// ghidra-rest serves analysis artifacts read-only: the names in them are
// whatever Ghidra decided, and `FUN_00101250` / `local_128` is most of what it
// decides. Cutter lets you fix that and the new name shows up everywhere at
// once. This is that, and it syncs -- see `sync.svelte.ts`.
//
// Two scopes, because names have two scopes:
//
//   symbol  keyed by ADDRESS. A function, a data label, a jump label. The same
//           thing appears in the function list, as a call operand in the
//           listing, as a node in both graphs, as an xref -- keying on the
//           address is what makes one rename land in all of them.
//   local   keyed by (function entry, original identifier). `local_128` in one
//           function has nothing to do with `local_128` in the next, so a
//           rename must not leak between them.
//
// Renames are never applied by rewriting stored text. Views resolve them at
// render time: by address where an address is in hand, otherwise by matching a
// whole token against the original name. A blind string replace would hit
// substrings, string literals and comments -- `main` inside `domain`, `puts`
// inside `fputs` -- and there is no undo for a corrupted listing.
//
// The in-memory document is the same shape the server stores, so syncing is a
// merge of two documents rather than a translation between two models.

import { normAddr } from '$lib/format';

/** `at` is this device's clock at the moment of the edit; merges turn on it. */
export type Entry = { from?: string; to: string; at: number; by?: string };

export type Doc = {
	version: number;
	job: string;
	rev: number;
	updated_at?: string;
	symbols: Record<string, Entry>;
	locals: Record<string, Entry>;
	/** byte patches: `{ "1040d0": { changes: "a1 a1 a1 a1" } }`, nothing else */
	patches: Record<string, Patch>;
};

export type Patch = { changes: string };

const KEY = 'guttex.renames';
const DEVICE_KEY = 'guttex.device';

const blank = (job: string): Doc => ({
	version: 1,
	job,
	rev: 0,
	symbols: {},
	locals: {},
	patches: {}
});

/**
 * `"a0B0"` / `"a0 b0"` -> `"a0 b0"`; empty string when it is not whole bytes.
 * One canonical spelling, because these strings are compared and merged.
 */
export function normAob(aob: string): string {
	const s = (aob ?? '').replace(/[\s,]+/g, '').toLowerCase();
	if (!s || s.length % 2 || /[^0-9a-f]/.test(s)) return '';
	return s.replace(/(..)(?=.)/g, '$1 ');
}

/** stable-ish name for this browser, so a sync can say where a rename came from */
function deviceId(): string {
	if (typeof localStorage === 'undefined') return '';
	let d = localStorage.getItem(DEVICE_KEY);
	if (!d) {
		d = Math.random().toString(36).slice(2, 8);
		try {
			localStorage.setItem(DEVICE_KEY, d);
		} catch {
			/* private mode: an unstable id is still better than none */
		}
	}
	return d;
}

function load(): Record<string, Doc> {
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Record<string, Doc>) : {};
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

class Renames {
	/** every job in one object: one `$state` read covers any lookup, so a
	    rename repaints every view that displayed the old name */
	private docs = $state<Record<string, Doc>>({});
	/** bumped on every change; the alias cache and its readers key off it */
	private ver = $state(0);
	/** jobs with edits the server has not acknowledged */
	private unsent = $state<Record<string, boolean>>({});

	private cache: { job: string; ver: number; map: Map<string, string> } | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;

	/** set by the sync layer; called whenever a local edit needs pushing */
	onDirty: ((job: string) => void) | null = null;

	readonly device = typeof localStorage === 'undefined' ? '' : deviceId();

	constructor() {
		// localStorage is the offline cache, not the record. It is what makes a
		// rename survive a reload on a train, and what the sync layer pushes
		// once the server is reachable again.
		if (typeof localStorage !== 'undefined') this.docs = load();
	}

	private save() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			try {
				localStorage.setItem(KEY, JSON.stringify(this.docs));
			} catch {
				/* private mode, or a full quota: the renames still work this session */
			}
		}, 250);
	}

	doc(job: string): Doc {
		return this.docs[job] ?? blank(job);
	}

	private put(job: string, next: Doc, local: boolean) {
		this.docs = { ...this.docs, [job]: next };
		this.ver++;
		this.save();
		if (local) {
			this.unsent = { ...this.unsent, [job]: true };
			this.onDirty?.(job);
		}
	}

	private edit(job: string, fn: (d: Doc) => void) {
		const cur = this.doc(job);
		const next: Doc = {
			...cur,
			symbols: { ...cur.symbols },
			locals: { ...cur.locals },
			patches: { ...(cur.patches ?? {}) }
		};
		fn(next);
		this.put(job, next, true);
	}

	// ----------------------------------------------------------------- patches

	/**
	 * Record a patch: `changes` is the new bytes, and its length is the
	 * patch -- `"a1 a1 a1 a1"` at 1040d0 overwrites that byte and the next
	 * three. Nothing else is stored. The binary is never touched; the patch
	 * is applied to a copy when the binary is exported.
	 */
	setPatch(job: string, addr: string, changes: string) {
		const a = normAddr(addr);
		if (!job || !a || !changes) return;
		this.edit(job, (d) => {
			d.patches[a] = { changes };
		});
	}

	delPatch(job: string, addr: string) {
		const a = normAddr(addr);
		if (!this.doc(job).patches?.[a]) return;
		this.edit(job, (d) => {
			delete d.patches[a];
		});
	}

	patchOf(job: string, addr: string): string | undefined {
		void this.ver;
		return this.docs[job]?.patches?.[normAddr(addr)]?.changes;
	}

	/** patches, addresses ascending, for the list and the hex overlay */
	patchList(job: string): { addr: string; changes: string }[] {
		void this.ver;
		return Object.entries(this.doc(job).patches ?? {})
			.map(([addr, e]) => ({ addr, changes: e.changes }))
			.sort((x, y) => (BigInt('0x' + x.addr) < BigInt('0x' + y.addr) ? -1 : 1));
	}

	patchCount(job: string): number {
		return this.patchList(job).length;
	}

	// ----------------------------------------------------------------- symbols

	symOf(job: string, addr: string): string | undefined {
		if (!job || !addr) return undefined;
		return this.docs[job]?.symbols[normAddr(addr)]?.to || undefined;
	}

	/** what Ghidra called it, kept so the name can be matched as a token */
	origOf(job: string, addr: string): string | undefined {
		if (!job || !addr) return undefined;
		return this.docs[job]?.symbols[normAddr(addr)]?.from;
	}

	setSym(job: string, addr: string, from: string, to: string) {
		const a = normAddr(addr);
		if (!job || !a) return;
		const name = to.trim();
		// Back to what Ghidra called it is a removal -- but it is written as a
		// tombstone, not a delete, or another device would resurrect the name
		// the next time it pushed.
		this.edit(job, (d) => {
			d.symbols[a] = { from, to: name === from ? '' : name, at: Date.now(), by: this.device };
		});
	}

	// ------------------------------------------------------------------ locals

	private lkey(fnAddr: string, ident: string) {
		return `${normAddr(fnAddr)}:${ident}`;
	}

	localOf(job: string, fnAddr: string, ident: string): string | undefined {
		if (!job || !fnAddr || !ident) return undefined;
		return this.docs[job]?.locals[this.lkey(fnAddr, ident)]?.to || undefined;
	}

	setLocal(job: string, fnAddr: string, ident: string, to: string) {
		if (!job || !fnAddr || !ident) return;
		const name = to.trim();
		this.edit(job, (d) => {
			d.locals[this.lkey(fnAddr, ident)] = {
				from: ident,
				to: name === ident ? '' : name,
				at: Date.now(),
				by: this.device
			};
		});
	}

	// ----------------------------------------------------------------- lookups

	/**
	 * original name -> new name, for the places that only have text: an operand
	 * token in the listing, an identifier in the decompiled C. Rebuilt only when
	 * something changed, since it is read once per rendered token.
	 */
	aliases(job: string): Map<string, string> {
		void this.ver; // subscribe: callers must repaint when a rename lands
		if (this.cache && this.cache.job === job && this.cache.ver === this.ver) return this.cache.map;
		const m = new Map<string, string>();
		for (const e of Object.values(this.doc(job).symbols)) {
			if (e.from && e.to) m.set(e.from, e.to);
		}
		this.cache = { job, ver: this.ver, map: m };
		return m;
	}

	/**
	 * Original names whose *new* name matches `q`. The result lists filter
	 * server-side and ghidra-rest has never heard of these names, so a search
	 * for a renamed function has to be turned back into a search Ghidra can
	 * answer.
	 */
	originalsFor(job: string, q: string, limit = 8): string[] {
		const needle = q.trim().toLowerCase();
		if (!needle) return [];
		const out: string[] = [];
		for (const e of Object.values(this.doc(job).symbols)) {
			if (e.from && e.to && e.to.toLowerCase().includes(needle)) out.push(e.from);
			if (out.length >= limit) break;
		}
		return out;
	}

	count(job: string): number {
		void this.ver;
		const d = this.doc(job);
		const n = (r: Record<string, Entry>) => Object.values(r).filter((e) => e.to !== '').length;
		return n(d.symbols) + n(d.locals);
	}

	clear(job: string) {
		// tombstone everything, so the removal actually propagates
		this.edit(job, (d) => {
			const at = Date.now();
			for (const k of Object.keys(d.symbols)) d.symbols[k] = { ...d.symbols[k], to: '', at };
			for (const k of Object.keys(d.locals)) d.locals[k] = { ...d.locals[k], to: '', at };
		});
	}

	// -------------------------------------------------------------------- sync

	pending(job: string): boolean {
		return !!this.unsent[job];
	}

	/**
	 * Fold the server's document into ours, by the same per-entry rule the
	 * server uses: later `at` wins. Anything of ours it did not have stays
	 * pending, so the next push carries it.
	 */
	mergeRemote(job: string, remote: Doc): { changed: boolean; owes: boolean } {
		const cur = this.doc(job);
		const next: Doc = {
			...cur,
			rev: remote.rev,
			updated_at: remote.updated_at,
			symbols: { ...cur.symbols },
			locals: { ...cur.locals },
			patches: { ...(cur.patches ?? {}) }
		};
		if (!this.unsent[job]) next.patches = { ...(remote.patches ?? {}) };
		let changed = false;
		let owes = false;
		for (const side of ['symbols', 'locals'] as const) {
			const theirs = remote[side] ?? {};
			for (const [k, e] of Object.entries(theirs)) {
				const have = next[side][k];
				if (!have || e.at > have.at) {
					next[side][k] = e;
					changed = true;
				} else if (have.at > e.at) {
					owes = true; // ours is newer: the server has not seen it yet
				}
			}
			for (const k of Object.keys(next[side])) {
				if (!(k in theirs)) owes = true;
			}
		}
		this.put(job, next, false);
		this.unsent = { ...this.unsent, [job]: owes };
		return { changed, owes };
	}

	/** the server acknowledged everything we had as of this document */
	markSynced(job: string, remote: Doc) {
		this.mergeRemote(job, remote);
		this.unsent = { ...this.unsent, [job]: false };
	}
}

export const renames = new Renames();

/** display name for something that has an address */
export function dispName(job: string, addr: string, name: string): string {
	return renames.symOf(job, addr) ?? renames.aliases(job).get(name) ?? name;
}

/** display name for a bare token, where only the text is known */
export function aliasName(job: string, name: string): string {
	return renames.aliases(job).get(name) ?? name;
}

/** display name for an identifier inside one function */
export function localName(job: string, fnAddr: string, ident: string): string {
	return renames.localOf(job, fnAddr, ident) ?? ident;
}

/**
 * Ghidra's auto-generated names carry the address they refer to
 * (`FUN_00101250`, `DAT_00104010`, `LAB_001013a4`), which is what lets an
 * identifier in the decompiled C be resolved to a symbol without a lookup
 * table. Anything else is a local.
 */
const AUTO = /^(?:FUN|DAT|PTR|LAB|UNK|SUB|EXT|thunk_FUN)_([0-9a-fA-F]{4,16})$/;

export function addrInName(name: string): string {
	const m = AUTO.exec(name);
	return m ? normAddr(m[1]) : '';
}
