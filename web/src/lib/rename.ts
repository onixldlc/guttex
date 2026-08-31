// Opening the rename prompt. Two entry points, because a name is either tied
// to an address or scoped to one function -- see the header of
// `state/renames.svelte.ts` for why that distinction is the whole design.

import { displayAddr } from '$lib/format';
import { renamer } from '$lib/state/renamer.svelte';
import { dispName, localName, renames } from '$lib/state/renames.svelte';

/** rename whatever lives at `addr`: function, data label, jump label */
export function renameSymbol(job: string, addr: string, name: string) {
	if (!job || !addr) return;
	// A second rename must still remember Ghidra's name, or clearing the field
	// would "restore" the previous rename instead of the original.
	const original = renames.origOf(job, addr) ?? name;
	renamer.open({
		what: `symbol at ${displayAddr(addr)}`,
		current: dispName(job, addr, name),
		original,
		apply: (v) => renames.setSym(job, addr, original, v)
	});
}

/** rename an identifier inside one function: `local_128`, `uVar3`, `param_1` */
export function renameLocal(job: string, fnAddr: string, ident: string) {
	if (!job || !fnAddr || !ident) return;
	renamer.open({
		what: `variable in ${displayAddr(fnAddr)}`,
		current: localName(job, fnAddr, ident),
		original: ident,
		apply: (v) => renames.setLocal(job, fnAddr, ident, v)
	});
}
