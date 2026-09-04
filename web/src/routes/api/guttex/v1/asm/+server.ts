import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AsmError, assemble, disassemble, hexOf, type Arch, type Line } from '$lib/server/asm';

// One endpoint, both directions, because the patch editor needs both and they
// share an architecture: `mode: "asm"` assembles what was typed and answers
// with the bytes that would be written, `mode: "hex"` disassembles bytes and
// answers with the instructions they would become. Nothing here writes
// anything -- the answer goes in the editor's preview box, and only the user
// pressing apply turns it into a patch.

/** guard rails: this is a patch, not a compiler */
const MAX_TEXT = 4096;
const MAX_BYTES = 512;

type Body = {
	mode?: string;
	text?: string;
	addr?: string;
} & Arch;

type Answer = {
	ok: boolean;
	error?: string;
	/** the bytes, in the spelling patches are stored in */
	hex?: string;
	/** how many bytes that is -- the width of the patch */
	bytes?: number;
	/** what those bytes disassemble to */
	lines?: Line[];
	/** bytes at the end that did not decode to a whole instruction */
	trailing?: number;
};

function bytesOf(text: string): Uint8Array {
	const s = text.replace(/0x/gi, '').replace(/[\s,;]+/g, '');
	if (!s || s.length % 2 || /[^0-9a-f]/i.test(s)) throw new AsmError('not whole hex bytes');
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function addrOf(text: string | undefined): bigint {
	const s = (text ?? '').trim().replace(/^0x/i, '');
	if (!s) return 0n;
	if (!/^[0-9a-f]+$/i.test(s)) throw new AsmError(`not an address: ${text}`);
	return BigInt('0x' + s);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return json({ ok: false, error: 'expected a json body' } satisfies Answer, { status: 400 });
	}

	const mode = body.mode === 'hex' ? 'hex' : body.mode === 'asm' ? 'asm' : '';
	if (!mode) {
		return json({ ok: false, error: 'mode must be "asm" or "hex"' } satisfies Answer, {
			status: 400
		});
	}
	const text = (body.text ?? '').slice(0, MAX_TEXT);
	// An empty box is not an error; it is a box nobody has typed in yet.
	if (!text.trim()) return json({ ok: true } satisfies Answer);

	const arch: Arch = {
		language: body.language,
		processor: body.processor,
		bits: body.bits,
		endian: body.endian,
		thumb: body.thumb
	};

	try {
		const at = addrOf(body.addr);

		if (mode === 'asm') {
			const mc = await assemble(arch, text, at);
			if (mc.length > MAX_BYTES) throw new AsmError(`${mc.length} bytes is too big for a patch`);
			return json({ ok: true, hex: hexOf(mc), bytes: mc.length } satisfies Answer);
		}

		const mc = bytesOf(text);
		if (mc.length > MAX_BYTES) throw new AsmError(`${mc.length} bytes is too big for a patch`);
		const lines = await disassemble(arch, mc, at);
		// Capstone stops at the first byte that cannot start an instruction. The
		// tail it skipped is worth saying out loud: those bytes are still
		// written, they just are not code.
		const last = lines[lines.length - 1];
		const decoded = last ? Number(BigInt('0x' + last.addr) - at) + last.size : 0;
		return json({
			ok: true,
			hex: hexOf(mc),
			bytes: mc.length,
			lines,
			trailing: Math.max(0, mc.length - decoded)
		} satisfies Answer);
	} catch (e) {
		// A bad mnemonic is the user talking to the assembler, not a fault: it
		// belongs in the preview box, so it comes back 200 with `ok: false`.
		if (e instanceof AsmError) return json({ ok: false, error: e.message } satisfies Answer);
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Answer, {
			status: 500
		});
	}
};
