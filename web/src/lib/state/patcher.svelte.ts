// Pushing patched bytes into Ghidra's own program.
//
// A patch starts as an overlay: guttex re-decodes the bytes itself and swaps
// the rows into the listing (see patchview.svelte.ts). That is instant and it
// is honest about the listing, but it cannot touch the decompiler, the graph or
// the call graph -- those are Ghidra's output for the bytes Ghidra was given.
//
// This is how the bytes get given. The job's Ghidra project is still on disk,
// so ghidra-rest can write into it: patch, clear the affected code units,
// re-disassemble the one function and re-decompile it and its callers. A
// headless run, tens of seconds. The alternative -- submitting the patched file
// as a new job -- costs a second full copy of the binary and a full analysis,
// which on a 239 MiB target is 1.1 GB and eight minutes for four bytes.
//
// Nothing here is automatic. It runs when someone presses a button.

import { api } from '$lib/api/client';
import type { FunctionEntry, PatchApplied } from '$lib/api/types';
import { normAddr } from '$lib/format';
import { renames } from './renames.svelte';

const big = (a: string): bigint => BigInt('0x' + (normAddr(a) || '0'));

/** the ops.tsv form: contiguous lowercase hex, no separators */
const packed = (hex: string): string => hex.replace(/[\s,]+/g, '').toLowerCase();

export type Scope = { kind: 'function'; addr: string; name: string } | { kind: 'project' };

class Patcher {
	/**
	 * Bumped when the program's bytes changed on the server. Panels showing
	 * anything Ghidra produced -- listing, decompiled text -- read it so they
	 * repaint with what the patch produced instead of what it replaced.
	 */
	rev = $state(0);

	busy = $state(false);
	/** what is being pushed, for the button that is spinning */
	scope = $state<Scope | null>(null);
	progress = $state('');
	error = $state('');
	/** the last run's result, for the line under the button */
	last = $state<PatchApplied | null>(null);

	/** false once the server says this job kept no project to patch */
	editable = $state(true);

	get busyOn() {
		return this.busy ? this.scope : null;
	}

	/** patches recorded for `project` that land inside [entry, entry+size) */
	inFunction(project: string, fn: FunctionEntry | null): { address: string; bytes: string }[] {
		if (!project || !fn) return [];
		const entry = big(fn.address);
		// A function with no size is one guttex only knows the entry of; take
		// the entry byte alone rather than guessing at a body.
		const end = entry + BigInt(Math.max(fn.size ?? 1, 1));
		return this.#ops(project).filter((op) => {
			const at = big(op.address);
			return at >= entry && at < end;
		});
	}

	#ops(project: string): { address: string; bytes: string }[] {
		return renames
			.patchList(project)
			.map((p) => ({ address: normAddr(p.addr), bytes: packed(p.changes) }))
			.filter((op) => op.address && op.bytes && !/[^0-9a-f]/.test(op.bytes));
	}

	/**
	 * Push every patch inside one function. This is the cheap one: Ghidra
	 * re-disassembles a single body and re-decompiles it and its callers.
	 */
	async pushFunction(job: string, project: string, fn: FunctionEntry) {
		const ops = this.inFunction(project, fn);
		if (!ops.length) {
			this.error = `nothing is patched inside ${fn.name || fn.address}`;
			return;
		}
		await this.#push(job, ops, {
			kind: 'function',
			addr: normAddr(fn.address),
			name: fn.name || fn.address
		});
	}

	/**
	 * Push every patch in the project, in one headless run. Forty addresses
	 * cost one JVM start here, not forty.
	 */
	async pushProject(job: string, project: string) {
		await this.#pushState(job, this.#ops(project));
	}

	/**
	 * Make the program hold exactly `target` and nothing else.
	 *
	 * A project-level push is a checkout, not an addition: an address the
	 * program has patched and the target does not is a patch that has to come
	 * back out, or loading an older commit would leave newer bytes behind and
	 * quietly show a state that never existed. ghidra-rest's ledger is what
	 * says which those are, and it kept the analyser's own bytes for each.
	 */
	async #pushState(job: string, target: { address: string; bytes: string }[]) {
		if (this.busy || !job) return;
		let ops = target;
		try {
			const want = new Set(target.map((o) => o.address));
			const stale = (await api.patches(job)).patch
				.map((e) => ({ address: normAddr(e.address), bytes: packed(e.original) }))
				.filter((o) => o.address && o.bytes && !want.has(o.address));
			ops = [...target, ...stale];
		} catch (e) {
			// No ledger to read means nothing was ever patched through it --
			// or the server is older than this feature. Either way the target
			// is still the right thing to write.
			if (/kept no Ghidra project/.test(e instanceof Error ? e.message : '')) {
				this.editable = false;
				this.error = e instanceof Error ? e.message : String(e);
				return;
			}
		}
		if (!ops.length) {
			this.error = 'this project has no byte patches';
			return;
		}
		await this.#push(job, ops, { kind: 'project' });
	}

	async #push(job: string, ops: { address: string; bytes: string }[], scope: Scope) {
		if (this.busy || !job) return;
		this.busy = true;
		this.scope = scope;
		this.error = '';
		this.last = null;
		const what =
			scope.kind === 'function'
				? `${scope.name}`
				: `${ops.length} patch${ops.length === 1 ? '' : 'es'}`;
		this.progress = `giving ${what} to Ghidra...`;
		try {
			const res = await api.applyPatches(job, ops);
			this.last = res;
			this.progress = `${res.applied} applied, ${res.functions.length} function${
				res.functions.length === 1 ? '' : 's'
			} re-analysed in ${(res.duration_ms / 1000).toFixed(1)}s`;
			this.rev++;
		} catch (e) {
			// 409 is also "this job has not finished analysing", which is
			// temporary; only the missing-project one is permanent, so it is
			// matched on rather than on the status alone.
			if (e instanceof Error && /kept no Ghidra project/.test(e.message)) {
				this.editable = false;
			}
			this.error = e instanceof Error ? e.message : String(e);
			this.progress = '';
			// Even a partial failure changed something; repaint either way.
			this.rev++;
		} finally {
			this.busy = false;
		}
	}

	dismiss() {
		if (this.busy) return;
		this.progress = '';
		this.error = '';
		this.last = null;
	}
}

export const patcher = new Patcher();
