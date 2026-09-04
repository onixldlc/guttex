// What language the open binary is in, in the shape `/asm` asks for.
//
// Ghidra's language id (`x86:LE:64:default`) is the whole answer when the
// analysis recorded one; the separate processor/size/endian fields are the
// fallback for an older artifact set.

import type { AsmAsk } from '$lib/api/store';
import { session } from '$lib/state/session.svelte';

export function archOf(): Pick<AsmAsk, 'language' | 'processor' | 'bits' | 'endian'> {
	const s = session.summary;
	return {
		language: s?.language,
		processor: s?.processor,
		bits: s?.address_size,
		endian: s?.endian
	};
}
