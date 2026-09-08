// Everything guttex can do, in one place.
//
// Before this there was no such list. A command was whatever code happened to
// sit behind whichever button needed it, so the same action was written out
// two or three times -- `renameSymbol` from the context menu, the rename
// dialog's own `n` shortcut and the phone sheet -- and `editAt` was written
// once, in the context menu, which is why editing bytes was reachable by
// right-click and by nothing else.
//
// What is shared is what a command *is*: what it does, and when it applies.
// What is not shared is how any surface draws it. The desktop title bar is
// still a dropdown with expanding groups, the phone is still a bottom sheet,
// the context menu is still a context menu -- each one filters this list and
// lays the result out its own way. They are not converging and they are not
// meant to.
//
// `when` is the part that removes clutter: a surface shows the commands that
// apply and omits the rest, instead of rendering a disabled row to say there
// is nothing to do.

import { displayAddr } from '$lib/format';
import { device } from '$lib/state/device.svelte';
import { exporter } from '$lib/state/exporter.svelte';
import { patcher } from '$lib/state/patcher.svelte';
import { plugins } from '$lib/plugins/host.svelte';
import { renames, dispName, localName } from '$lib/state/renames.svelte';
import { session } from '$lib/state/session.svelte';
import { signer } from '$lib/state/signature.svelte';
import { asmMark } from '$lib/state/asmmark.svelte';
import { asmSel, type CopyKind } from '$lib/state/asmsel.svelte';
import { renameLocal, renameSymbol } from '$lib/rename';
import { renamer } from '$lib/state/renamer.svelte';
import { patchEditor } from '$lib/state/editor.svelte';
import { editAt } from '$lib/patch';

/**
 * The thing a context menu was opened on.
 *
 * `addr` is '' for a decompiler identifier that resolved to no address -- a
 * local, which can be renamed but has nothing to open. `row` is the listing
 * row under the pointer, which is not always `addr`: right-clicking a jump
 * operand targets the destination, while the row is still what would be
 * edited.
 */
export type Target = {
	addr: string;
	name: string;
	ident?: string;
	line?: number;
	row?: string;
};

export type Ctx = {
	/** null for surfaces that act on the session rather than on a thing */
	target: Target | null;
};

/** Where a command may appear. A command with none is keyboard-only. */
export type Surface = 'menu' | 'context' | 'sheet';

export type Command = {
	id: string;
	/** may depend on context: "rename" against "rename variable" */
	label: (c: Ctx) => string;
	run: (c: Ctx) => void;
	/** false means the surface omits it entirely -- never a disabled row */
	when: (c: Ctx) => boolean;
	/**
	 * The command applies, but something it needs is already in flight. A
	 * surface shows it disabled rather than hiding it: a control that vanishes
	 * mid-action is worse than one that greys out, because the thing you just
	 * pressed is where you are looking.
	 */
	busy?: () => boolean;
	/** single key, no modifiers, ignored while typing */
	key?: string;
	/**
	 * A keycap to print next to the label without binding anything -- for a
	 * command that another entry already owns the key for. `rename` on a
	 * right-clicked target is the same action as the `n` shortcut, and saying so
	 * is how anyone finds out the shortcut exists.
	 */
	hint?: string;
	/**
	 * Which cluster this belongs to. A menu may render a group as a submenu, a
	 * context menu as a run of items between separators. It says what the
	 * command is near, not how it is drawn.
	 */
	group?: string;
	on: Surface[];
};

// ---------------------------------------------------------------- helpers

const EMPTY: Ctx = { target: null };

/**
 * The job whose *original* bytes and artifacts to export. Patching writes into
 * the job's own Ghidra project, so a job can hold bytes that are no longer the
 * project's; when the open job is not this binary's own, the server falls back
 * to the one recorded on the project.
 */
const ownJob = () => (session.job?.sha256 === session.project ? session.id : undefined);

const patchCount = () => (session.project ? renames.patchCount(session.project) : 0);
const fnPatches = () => patcher.inFunction(session.project, session.fn).length;

const plural = (n: number) => `${n} patch${n === 1 ? '' : 'es'}`;

/** what the rest of the UI shows for a target, renames included */
export function shownName(t: Target | null): string {
	if (!t) return '';
	if (t.ident) return localName(session.project, session.addr, t.ident);
	if (t.addr) return dispName(session.project, t.addr, t.name);
	return '';
}

const rowsFor = (t: Target | null) => (t && t.addr && !t.ident ? asmSel.rows(t.addr).length : 0);

async function copy(text: string, label?: string) {
	try {
		// Unavailable on insecure origins, which a LAN http:// deploy is.
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
		} else {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
			document.body.append(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		}
		plugins.notify('guttex', `copied ${label ?? text}`);
	} catch {
		plugins.notify('guttex', `could not copy: ${label ?? text}`, 'warn');
	}
}

/** Copy the highlighted rows in one of the listing's three shapes. */
function copyLines(t: Target, kind: CopyKind, what: string) {
	const text = asmSel.format(kind, t.addr);
	if (!text) return;
	const n = text.split('\n').length;
	copy(text, `${n} line${n === 1 ? '' : 's'} of ${what}`);
}

/**
 * Mark the instructions behind a decompiled line and show them. The decompiler
 * owns the mapping; this only asks for it. A line Ghidra mapped to nothing says
 * so rather than switching to a listing that would look unchanged.
 */
async function toAsmLine(line: number) {
	if (await asmMark.goto(line)) session.tab = 'disasm';
	else plugins.notify('guttex', `line ${line} maps to no instructions`, 'warn');
}

/**
 * The same move from the graph. An instruction inside the function on screen is
 * marked and the *function* is opened -- the listing is fetched per function, so
 * selecting the instruction's own address would ask for a function that does not
 * start there. A target that leaves the function is a plain navigation.
 */
function toAsmAddr(t: Target) {
	const sc = asmMark.scope;
	if (sc?.has(t.addr)) {
		asmMark.set(sc.fn, 0, [t.addr], 'graph');
		session.select(sc.fn, 'disasm');
	} else {
		session.select(t.addr, 'disasm');
	}
}

const urlFor = (addr: string) =>
	new URL(`${device.job(session.id)}?a=${encodeURIComponent(addr)}`, location.href).href;

// --------------------------------------------------------------- the list

export const COMMANDS: Command[] = [
	// ---- the session ----
	{
		id: 'export-project',
		label: () => (exporter.busy ? 'exporting...' : 'export project'),
		when: () => !!session.project,
		busy: () => exporter.busy,
		run: () => exporter.run(session.project, ownJob()),
		on: ['menu', 'sheet']
	},
	{
		id: 'export-binary-original',
		group: 'export binary',
		label: () => 'original',
		when: () => !!session.project,
		busy: () => exporter.busy,
		run: () =>
			exporter.runBinary(session.project, 'original', ownJob(), session.summary?.image_base),
		on: ['menu']
	},
	{
		id: 'export-binary-patched',
		group: 'export binary',
		label: () => `patched (${plural(patchCount())})`,
		when: () => !!session.project && patchCount() > 0,
		busy: () => exporter.busy,
		run: () =>
			exporter.runBinary(session.project, 'patched', ownJob(), session.summary?.image_base),
		on: ['menu']
	},
	{
		id: 'rebuild-function',
		group: 'rebuild',
		label: () => `this function (${plural(fnPatches())})`,
		when: () => !!session.id && !!session.fn && patcher.editable && fnPatches() > 0,
		busy: () => patcher.busy,
		run: () => {
			if (session.fn) void patcher.pushFunction(session.id, session.project, session.fn);
		},
		on: ['menu']
	},
	{
		id: 'rebuild-binary',
		group: 'rebuild',
		label: () => `whole binary (${plural(patchCount())})`,
		when: () => !!session.id && patcher.editable && patchCount() > 0,
		busy: () => patcher.busy,
		run: () => void patcher.pushProject(session.id, session.project),
		on: ['menu']
	},
	{
		id: 'console',
		label: () => 'console',
		when: () => true,
		run: () => {
			session.consoleOpen = !session.consoleOpen;
			if (session.consoleOpen) session.refreshLog();
		},
		on: ['menu']
	},
	{
		id: 'rename-here',
		// Cutter's key, for the function you are looking at, without having to
		// find something to right-click.
		key: 'n',
		label: () => 'rename',
		when: () => !!session.addr,
		run: () => renameSymbol(session.project, session.addr, session.fn?.name ?? ''),
		on: ['sheet']
	},
	{
		id: 'signature-here',
		// Ghidra's key for the same dialog.
		key: 'f',
		label: () => 'edit signature',
		when: () => !!session.id && !!session.addr && !!session.fn,
		run: () => {
			if (!session.fn) return;
			signer.open({
				job: session.id,
				addr: session.addr,
				name: session.fn.name,
				current: session.fn.signature ?? ''
			});
		},
		on: []
	},

	// ---- a right-clicked thing ----
	{
		id: 'edit',
		label: (c) => {
			const n = rowsFor(c.target);
			return `edit${n > 1 ? ` (${n} lines)` : ''}`;
		},
		// In the listing, an instruction's own row edits its bytes: the name of a
		// thing is what the other views are for.
		when: (c) => !!c.target?.row && c.target.row === c.target.addr,
		run: (c) => c.target?.row && editAt(session.project, c.target.row),
		on: ['context']
	},
	{
		id: 'rename',
		hint: 'n',
		label: (c) => `rename${c.target?.ident ? ' variable' : ''}`,
		when: (c) =>
			!!c.target &&
			!(c.target.row && c.target.row === c.target.addr) &&
			!!(c.target.ident || c.target.addr),
		run: (c) => {
			const t = c.target;
			if (!t) return;
			if (t.ident) renameLocal(session.project, session.addr, t.ident);
			else renameSymbol(session.project, t.addr, t.name);
		},
		on: ['context']
	},
	{
		id: 'to-disasm-line',
		label: () => 'go to disassembly',
		when: (c) => !!c.target?.line,
		run: (c) => void toAsmLine(c.target!.line!),
		on: ['context']
	},
	{
		id: 'to-disasm-addr',
		label: () => 'go to disassembly',
		when: (c) => !!c.target?.addr && !c.target.line && session.tab !== 'disasm',
		run: (c) => c.target && toAsmAddr(c.target),
		on: ['context']
	},
	{
		id: 'open',
		group: 'nav',
		label: () => 'open',
		when: (c) => !!c.target?.addr,
		run: (c) => c.target && session.select(c.target.addr),
		on: ['context']
	},
	{
		id: 'open-new-tab',
		group: 'nav',
		label: () => 'open in new tab',
		when: (c) => !!c.target?.addr,
		run: (c) => c.target && window.open(urlFor(c.target.addr), '_blank', 'noopener'),
		on: ['context']
	},
	{
		id: 'copy-address',
		group: 'copy',
		label: () => 'copy address',
		when: (c) => !!c.target?.addr,
		run: (c) => c.target && copy(displayAddr(c.target.addr)),
		on: ['context']
	},
	{
		id: 'copy-name',
		group: 'copy',
		label: () => 'copy name',
		when: (c) => !!shownName(c.target),
		run: (c) => copy(shownName(c.target)),
		on: ['context']
	},
	{
		id: 'copy-selection',
		group: 'copy-rows',
		label: (c) => {
			const n = rowsFor(c.target);
			return `copy selection${n > 1 ? ` (${n} lines)` : ''}`;
		},
		when: (c) => rowsFor(c.target) > 0,
		run: (c) => c.target && copyLines(c.target, 'full', 'listing'),
		on: ['context']
	},
	{
		id: 'copy-selection-address',
		group: 'copy-rows',
		label: () => 'copy selection address',
		when: (c) => rowsFor(c.target) > 0,
		run: (c) => c.target && copyLines(c.target, 'addr', 'addresses'),
		on: ['context']
	},
	{
		id: 'copy-selection-hex',
		group: 'copy-rows',
		label: () => 'copy selection hex',
		when: (c) => rowsFor(c.target) > 0,
		run: (c) => c.target && copyLines(c.target, 'hex', 'bytes'),
		on: ['context']
	},
	{
		id: 'copy-selection-asm',
		group: 'copy-rows',
		label: () => 'copy selection asm',
		when: (c) => rowsFor(c.target) > 0,
		run: (c) => c.target && copyLines(c.target, 'asm', 'asm'),
		on: ['context']
	}
];

/** the commands this surface offers right now, in catalogue order */
export function commandsFor(surface: Surface, ctx: Ctx = EMPTY): Command[] {
	return COMMANDS.filter((c) => c.on.includes(surface) && c.when(ctx));
}

/** the same, split into runs of one group -- what a menu draws separators between */
export function groupedFor(surface: Surface, ctx: Ctx = EMPTY): Command[][] {
	const out: Command[][] = [];
	for (const c of commandsFor(surface, ctx)) {
		const last = out[out.length - 1];
		if (last && last[0].group === c.group) last.push(c);
		else out.push([c]);
	}
	return out;
}

/**
 * Run the command bound to a bare keypress, if any.
 *
 * Shortcuts live here rather than inside whichever dialog claimed them --
 * `f` used to be owned by `SignatureDialog`, which meant a global key was a
 * property of a component that is usually not even mounted.
 */
export function runKey(e: KeyboardEvent): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	// A dialog is a mode. `n` inside the rename prompt is a letter, not a
	// command -- and Escape out of it belongs to the dismissable action.
	if (renamer.ask || patchEditor.ask || signer.ask) return false;
	const el = e.target as HTMLElement | null;
	if (
		el &&
		(el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' ||
			el.isContentEditable)
	) {
		return false;
	}
	const c = COMMANDS.find((x) => x.key === e.key && x.when(EMPTY));
	if (!c) return false;
	e.preventDefault();
	c.run(EMPTY);
	return true;
}
