// The instruction editor's one prompt, the same shape as `renamer`: the
// listing asks for it, `EditDialog` is the only thing that reads it.
//
// Nothing here writes bytes. What the dialog produces is a line in the
// project's patch log -- `{ "<addr>": { "changes": "a1 a1" } }` -- and the
// binary is only touched when it is exported.

export type EditAsk = {
	/** normalised address the patch starts at */
	addr: string;
	/** the bytes there now, or the patch already recorded for this address */
	bytes: string;
	/** what those bytes currently read as, one instruction per line */
	asm: string;
	/** how many instructions were selected when this was opened */
	rows: number;
	/** a patch is already recorded here, so the dialog can offer to drop it */
	patched: boolean;
};

class PatchEditor {
	ask = $state<EditAsk | null>(null);

	open(a: EditAsk) {
		this.ask = a;
	}

	close() {
		this.ask = null;
	}
}

export const patchEditor = new PatchEditor();
