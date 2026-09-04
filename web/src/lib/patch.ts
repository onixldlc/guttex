// Opening the instruction editor. The listing right-click is the only caller,
// and everything it needs is already on screen: the rows it has highlighted
// carry both the bytes and the text they read as.

import { normAddr } from '$lib/format';
import { asmSel } from '$lib/state/asmsel.svelte';
import { patchEditor } from '$lib/state/editor.svelte';
import { normAob, renames } from '$lib/state/renames.svelte';

/**
 * Edit the bytes at `addr`. A block of highlighted rows is edited as one
 * patch, starting at the first of them -- selecting three instructions and
 * typing one long one over them is the whole point.
 *
 * A patch already recorded here is what the box starts from, not the bytes
 * Ghidra saw: reopening an edit should show the edit.
 */
export function editAt(job: string, addr: string) {
	const a = normAddr(addr);
	if (!a) return;
	const rows = asmSel.rows(a);
	const at = rows.length ? normAddr(rows[0].address) : a;
	const patch = job ? renames.patchOf(job, at) : undefined;
	const bytes =
		patch ??
		rows
			.map((i) => i.bytes ?? '')
			.filter(Boolean)
			.join(' ');
	patchEditor.open({
		addr: at,
		bytes: normAob(bytes),
		// One line of input, so several instructions are separated the way an
		// assembler takes them rather than by newlines.
		asm: rows
			.map((i) => `${i.mnemonic}${i.operands ? ' ' + i.operands : ''}`)
			.join('; ')
			.trim(),
		rows: rows.length,
		patched: patch !== undefined
	});
}
