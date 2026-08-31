// The rename prompt is one dialog for the whole app: a function row, a call
// operand, a graph node and an identifier in the decompiled C all ask for the
// same thing, and each of them would otherwise carry its own popup.

export type Ask = {
	/** what is being renamed, shown above the field */
	what: string;
	/** the name currently displayed */
	current: string;
	/** what Ghidra called it, shown when it differs from `current` */
	original: string;
	apply: (name: string) => void;
};

class Renamer {
	ask = $state<Ask | null>(null);

	open(a: Ask) {
		this.ask = a;
	}
	close() {
		this.ask = null;
	}
}

export const renamer = new Renamer();
