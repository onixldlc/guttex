// Patches, as seen in the listing.
//
// Ghidra decoded the bytes it was given and it will never see ours: the
// analysis is finished, the file it read is untouched, and re-running it is not
// something typing four bytes should cost. So a patch is overlaid the way a
// rename is -- resolved at render time. The rows a patch covers are re-decoded
// by capstone (through `/asm`) and swapped into the listing; every other row is
// still exactly what ghidra-rest sent.
//
// The re-decoded window starts at the first instruction the patch touches and
// ends at the last one, plus whatever the patch runs past. Rows after it keep
// Ghidra's decode even when the patch ended mid-instruction and everything
// downstream has really shifted: guttex knows what it patched, it does not know
// what the rest of the function became, and quietly re-decoding to the end of
// the function would be pretending otherwise. Bytes inside the window that do
// not decode are shown as data.
//
// What this does *not* fix is the decompiler, the graph and the call graph:
// those are Ghidra's own output for the original bytes. Patch, export the
// patched binary, analyse that if you need C back.

import { store, type AsmLine } from '$lib/api/store';
import type { Instruction } from '$lib/api/types';
import { archOf } from '$lib/arch';
import { normAddr } from '$lib/format';
import { renames } from './renames.svelte';

export type Overlay = {
	/** the listing to draw: Ghidra's, with patched windows swapped in */
	lines: Instruction[];
	/** addresses of rows that came from a patch, for the styling */
	hot: Set<string>;
	/** a window is still being decoded */
	busy: boolean;
	/** why a window could not be decoded, if one could not */
	error: string;
};

// Enough to colour the mnemonic and make a direct branch clickable. Capstone
// says what an instruction is called, not what it does, so the listing's own
// call/jump/terminal flags have to be inferred from the name.
const CALL = /^(call|lcall|bl|blx|blr|bsr|jal|jalr)$/;
const JUMP = /^(jmp|ljmp|b|bx|br|j[a-z]{1,3}|beq|bne|cbn?z|tbn?z)$/;
const TERM = /^(ret|retn|retf|iret[dq]?|eret|hlt|ud2|brk|trap)$/;

const big = (a: string): bigint => BigInt('0x' + (normAddr(a) || '0'));

const hexOf = (b: number[]): string => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');

function bytesOf(hex: string | undefined): number[] | null {
	const s = (hex ?? '').replace(/[\s,]+/g, '');
	if (!s || s.length % 2 || /[^0-9a-f]/i.test(s)) return null;
	const out: number[] = [];
	for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
	return out;
}

/** capstone's lines -> listing rows, bytes taken back out of the window */
function rowsFrom(lines: AsmLine[], win: number[], at: bigint, trailing: number): Instruction[] {
	const out: Instruction[] = lines.map((l) => {
		const off = Number(big(l.addr) - at);
		const sp = l.text.indexOf(' ');
		const mnemonic = (sp < 0 ? l.text : l.text.slice(0, sp)).toUpperCase();
		const operands = sp < 0 ? '' : l.text.slice(sp + 1).trim();
		const name = mnemonic.toLowerCase();
		const call = CALL.test(name);
		const jump = !call && JUMP.test(name);
		// A branch to a plain address is the one thing worth wiring back up:
		// the listing draws `flow` as a link and resolves it to a name.
		const direct = /^0x[0-9a-f]+$/i.test(operands) ? normAddr(operands) : '';
		return {
			address: normAddr(l.addr),
			bytes: hexOf(win.slice(off, off + l.size)),
			mnemonic,
			operands,
			length: l.size,
			is_call: call,
			is_jump: jump,
			is_terminal: TERM.test(name),
			flow: (call || jump) && direct ? direct : undefined
		};
	});

	if (trailing > 0) {
		const off = win.length - trailing;
		out.push({
			address: normAddr((at + BigInt(off)).toString(16)),
			bytes: hexOf(win.slice(off)),
			mnemonic: 'DB',
			operands: win
				.slice(off)
				.map((b) => '0x' + b.toString(16).padStart(2, '0'))
				.join(', '),
			length: trailing,
			comment: 'not an instruction'
		});
	}
	return out;
}

class PatchView {
	/** window key -> the rows it decoded to */
	#done = new Map<string, Instruction[]>();
	/** window key -> why it did not decode; keeps a failure from refetching */
	#failed = new Map<string, string>();
	#inflight = new Set<string>();

	/** bumped when a decode lands, which is what re-runs `apply` */
	ver = $state(0);

	/**
	 * Overlay `job`'s patches onto a listing. Cheap and synchronous: anything
	 * it has not decoded yet is requested in the background and the untouched
	 * listing is returned until the answer arrives.
	 */
	apply(job: string, lines: Instruction[]): Overlay {
		void this.ver;
		const plain: Overlay = { lines, hot: new Set<string>(), busy: false, error: '' };
		if (!job || !lines.length) return plain;
		const patches = renames.patchList(job);
		if (!patches.length) return plain;

		const rows = lines.map((ins) => ({ ins, at: big(ins.address), b: bytesOf(ins.bytes) }));

		// Every patched byte by address, so a row is "touched" without caring
		// which patch touched it -- two patches inside one instruction are one
		// window, not two.
		const byAddr = new Map<string, number>();
		for (const p of patches) {
			const pb = bytesOf(p.changes);
			if (!pb) continue;
			const start = big(p.addr);
			pb.forEach((v, k) => byAddr.set((start + BigInt(k)).toString(), v));
		}
		if (!byAddr.size) return plain;

		const touched = (r: (typeof rows)[number]) => {
			if (!r.b) return false;
			for (let k = 0; k < r.b.length; k++) if (byAddr.has((r.at + BigInt(k)).toString())) return true;
			return false;
		};

		const out: Instruction[] = [];
		const hot = new Set<string>();
		let busy = false;
		let error = '';

		for (let i = 0; i < rows.length; ) {
			if (!touched(rows[i])) {
				out.push(rows[i].ins);
				i++;
				continue;
			}
			// The window: this row and every touched row after it.
			let j = i;
			const win = [...rows[i].b!];
			while (j + 1 < rows.length && touched(rows[j + 1]) && rows[j + 1].b) {
				j++;
				win.push(...rows[j].b!);
			}
			const at = rows[i].at;
			// Overwrite, extending when a patch runs past the last row it
			// overlaps -- those bytes are still part of the patch.
			for (let k = 0; ; k++) {
				const v = byAddr.get((at + BigInt(k)).toString());
				if (k < win.length) {
					if (v !== undefined) win[k] = v;
					continue;
				}
				if (v === undefined) break;
				win.push(v);
			}

			const key = at.toString(16) + '|' + hexOf(win);
			const done = this.#done.get(key);
			if (done) {
				for (const ins of done) {
					out.push(ins);
					hot.add(ins.address);
				}
			} else {
				const failed = this.#failed.get(key);
				if (failed) {
					error = failed;
				} else {
					busy = true;
					this.#decode(key, at, win);
				}
				// Until it decodes, the rows stay as Ghidra had them: a listing
				// that flickers empty is worse than one that is a moment stale.
				for (let k = i; k <= j; k++) out.push(rows[k].ins);
			}
			i = j + 1;
		}

		return { lines: out, hot, busy, error };
	}

	#decode(key: string, at: bigint, win: number[]) {
		if (this.#inflight.has(key)) return;
		this.#inflight.add(key);
		store
			.translate({ mode: 'hex', text: hexOf(win), addr: at.toString(16), ...archOf() })
			.then((r) => {
				if (!r.ok) this.#failed.set(key, r.error ?? 'the patched bytes did not decode');
				else this.#done.set(key, rowsFrom(r.lines ?? [], win, at, r.trailing ?? 0));
			})
			.catch((e) => this.#failed.set(key, e instanceof Error ? e.message : String(e)))
			.finally(() => {
				this.#inflight.delete(key);
				this.ver++;
			});
	}
}

export const patchView = new PatchView();
