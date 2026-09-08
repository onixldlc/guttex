// One edit, as the rename store reports it to whoever is listening.
//
// `at` is an address. For a local it is the *function's* entry and `ident` is
// the original identifier -- the same two-part key the rename store uses,
// because `local_128` in one function has nothing to do with `local_128` in
// the next.
//
// An empty `to` means "back to what Ghidra called it"; an empty `bytes` means
// the patch was removed. Both are reported rather than dropped: a listener
// that never hears about removals cannot stay in step.

export type Op =
	| { kind: 'rename'; at: string; from: string; to: string }
	| { kind: 'local'; at: string; ident: string; from: string; to: string }
	| { kind: 'patch'; at: string; bytes: string; was?: string }
	| { kind: 'signature'; at: string; from: string; to: string; convention?: string };
