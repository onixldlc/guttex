// Ghidra's own address book: address -> the name Ghidra gave it.
//
// The listing hands back branch targets as bare addresses (`CALL 0x006341eb`)
// even when the analyser knows perfectly well that the address is
// `__security_init_cookie`. Reading a listing that way means holding a dozen
// hex numbers in your head, so guttex resolves them at render time.
//
// Two layers, in this order:
//
//   1. the user's rename for that address  (renames.symOf -- authoritative)
//   2. Ghidra's name for that address      (this book -- the default)
//   3. the address itself                  (nothing knows it)
//
// This is the second layer only. It is a cache of what the server already
// said, never a source of truth, and nothing here is ever synced or exported:
// re-analysing the binary reproduces every one of these names.

import { api } from '$lib/api/client';
import type { FunctionEntry } from '$lib/api/types';
import { normAddr } from '$lib/format';
import { renames } from './renames.svelte';

/** an address that turned out not to be a function is remembered as a miss,
    so a listing full of data references does not re-ask on every repaint */
const MAX_MISS = 20_000;

class Book {
	/** job -> address -> Ghidra's name */
	#names = $state<Record<string, Record<string, string>>>({});
	#miss = new Set<string>();
	#busy = new Set<string>();
	/** jobs whose import table has been read */
	#imports = new Set<string>();

	#bin(job: string): Record<string, string> {
		let b = this.#names[job];
		if (!b) {
			b = {};
			this.#names[job] = b;
		}
		return b;
	}

	learn(job: string, addr: string, name: string) {
		if (!job || !addr || !name) return;
		const a = normAddr(addr);
		if (!a) return;
		const b = this.#bin(job);
		if (b[a] === name) return;
		b[a] = name;
	}

	/** a function entry names itself and everything on either side of it --
	    free, and it is exactly the set of targets the listing is about to show */
	learnFn(job: string, f: FunctionEntry | null | undefined) {
		if (!f) return;
		this.learn(job, f.address, f.name);
		for (const c of f.calls ?? []) this.learn(job, c.address, c.name);
		for (const c of f.called_by ?? []) this.learn(job, c.address, c.name);
	}

	learnMany(job: string, rows: Iterable<{ address: string; name: string }>) {
		for (const r of rows) this.learn(job, r.address, r.name);
	}

	nameOf(job: string, addr: string): string | undefined {
		if (!job || !addr) return undefined;
		return this.#names[job]?.[normAddr(addr)];
	}

	/**
	 * Same as `nameOf`, but a miss starts a lookup. Only call this for
	 * addresses that are actually branch destinations -- asking the server
	 * about every numeric literal in a listing would be a request per constant.
	 */
	want(job: string, addr: string): string | undefined {
		const a = normAddr(addr);
		if (!job || !a) return undefined;
		const have = this.#names[job]?.[a];
		if (have) return have;
		// `external:a0` is a thunk, not a function -- asking `/function` for it
		// is a guaranteed 404. The import table is what names these.
		if (a.includes(':')) {
			this.externals(job);
			return undefined;
		}

		const k = `${job}:${a}`;
		if (this.#miss.has(k) || this.#busy.has(k)) return undefined;
		this.#busy.add(k);
		api
			.fn(job, a)
			.then((f) => this.learnFn(job, f))
			.catch(() => {
				// not a function: data, a string, or an address Ghidra never
				// resolved. Remembering that is what stops the retry loop.
				if (this.#miss.size > MAX_MISS) this.#miss.clear();
				this.#miss.add(k);
			})
			.finally(() => this.#busy.delete(k));
		return undefined;
	}

	/**
	 * Learn the whole import table.
	 *
	 * An imported function is called through its thunk, and Ghidra addresses
	 * that thunk as `external:a0` -- an address in no memory block, in no
	 * function list, so `want` can never resolve one however many times it is
	 * asked. The names live in the import table instead: a few hundred rows
	 * even for a large Windows binary, read once per job.
	 */
	externals(job: string) {
		if (!job || this.#imports.has(job)) return;
		this.#imports.add(job);
		const page = (offset: number): Promise<void> =>
			api.imports(job, { limit: 1000, offset }).then((p) => {
				for (const im of p.items) if (im.thunk_address) this.learn(job, im.thunk_address, im.name);
				const next = offset + (p.count || p.items.length);
				if (p.items.length && next < p.total) return page(next);
			});
		// a failed read is not cached: the next caller may as well try again
		page(0).catch(() => this.#imports.delete(job));
	}

	/** drop a job's book -- only needed when its analysis is rebuilt */
	forget(job: string) {
		delete this.#names[job];
		this.#imports.delete(job);
		for (const k of [...this.#miss]) if (k.startsWith(job + ':')) this.#miss.delete(k);
	}
}

export const book = new Book();

/** a token that is written as a hex address, and nothing else */
const HEX = /^0[xX][0-9a-fA-F]+$/;

/**
 * What an operand token should read as. Empty means "leave the token alone".
 *
 * `flow` is the instruction's single known destination, when it has one. That
 * is the only address worth a server round trip: everything else resolves from
 * what has already been learned, so a listing of arithmetic constants costs
 * nothing.
 */
export function operandName(project: string, job: string, token: string, flow?: string): string {
	if (!HEX.test(token)) return '';
	const a = normAddr(token);
	if (!a) return '';
	// An import is called through its IAT slot: `CALL dword ptr [0x006c927c]`,
	// where the operand is the slot and the destination is `external:a0`.
	// Ghidra names the destination, not the slot, so the slot is drawn as the
	// import it reaches -- which is what the decompiler shows for the same
	// call, and what makes a listing of a Windows binary readable.
	const dest = flow && flow.includes(':') ? normAddr(flow) : a;
	const mine = renames.symOf(project, dest);
	if (mine) return mine;
	return (flow && dest === normAddr(flow) ? book.want(job, dest) : book.nameOf(job, dest)) ?? '';
}

/**
 * The destination worth naming for an instruction: a call's target, and any
 * external, because an import reached by a tail jump is still an import. An
 * ordinary jump inside the function is left alone -- its target is a label,
 * not a name, and asking the server about every one of them is a request per
 * branch.
 */
export function namedFlow(ins: { flow?: string; is_call?: boolean }): string | undefined {
	if (!ins.flow) return undefined;
	return ins.is_call || ins.flow.includes(':') ? ins.flow : undefined;
}
