<script lang="ts">
	// Right-click menu for anything that carries an address (`data-addr`):
	// function rows, jump/call targets, xrefs. Right-clicking anywhere else is
	// left alone -- the browser's own menu is the correct menu for ordinary page
	// chrome, and stealing it everywhere is what makes web apps annoying.
	//
	// Escape hatches, because a hijacked right-click must always be recoverable:
	// shift+right-click never opens this menu, and "browser default" arms the
	// next right-click to pass straight through.
	import { plugins } from '$lib/plugins/host.svelte';
	import { displayAddr, normAddr } from '$lib/format';
	import { session } from '$lib/state/session.svelte';
	import { device } from '$lib/state/device.svelte';
	import { asmSel, type CopyKind } from '$lib/state/asmsel.svelte';
	import { asmMark } from '$lib/state/asmmark.svelte';
	import { dispName, localName } from '$lib/state/renames.svelte';
	import { renameLocal, renameSymbol } from '$lib/rename';
	import { editAt } from '$lib/patch';

	// `ident` is set for a decompiler identifier that resolved to no address --
	// a local. It can be renamed, but there is nothing to open or copy a link to.
	//
	// `line` is set anywhere inside a decompiled line, address or not. A line of
	// C is a target in its own right: it has instructions behind it even when
	// the token under the pointer is punctuation.
	// `row` is the address of the listing row the pointer is over, which is
	// not always `addr`: right-clicking a jump operand inside a row targets the
	// jump's destination, while the row itself is still the thing whose bytes
	// would be edited.
	type Target = {
		x: number;
		y: number;
		addr: string;
		name: string;
		ident?: string;
		line?: number;
		row?: string;
	};

	let menu = $state<Target | null>(null);
	let el = $state<HTMLElement | null>(null);
	let bypass = $state(false);

	// Rows a copy would take: the highlighted block, or the single row that was
	// right-clicked. Zero when the target is not a listing row at all, which is
	// what hides the copy items on a function or xref row.
	const selCount = $derived(menu && menu.addr && !menu.ident ? asmSel.rows(menu.addr).length : 0);
	// what the rest of the UI shows for this thing, renames included
	const shownName = $derived(
		!menu
			? ''
			: menu.ident
				? localName(session.project, session.addr, menu.ident)
				: menu.addr
					? dispName(session.project, menu.addr, menu.name)
					: ''
	);

	$effect(() => {
		const onMenu = (e: MouseEvent) => {
			if (bypass || e.shiftKey) {
				bypass = false;
				menu = null;
				return; // native menu
			}
			const el = e.target as HTMLElement | null;
			const hit = el?.closest?.('[data-addr]') as HTMLElement | null;
			const addr = normAddr(hit?.dataset.addr ?? '');
			// the decompiled line the pointer is on, if it is on one
			const lineHit = el?.closest?.('[data-line]') as HTMLElement | null;
			const line = Number(lineHit?.dataset.line ?? '') || undefined;
			// only the disassembly listing marks its rows, so this is also what
			// says "we are in the listing"
			const rowHit = el?.closest?.('[data-asm]') as HTMLElement | null;
			const row = normAddr(rowHit?.dataset.asm ?? '') || undefined;
			if (!addr) {
				// a decompiled identifier with no symbol behind it: still renameable
				const idHit = el?.closest?.('[data-id]') as HTMLElement | null;
				const ident = idHit?.dataset.id ?? '';
				if (!ident && !line) {
					menu = null;
					return; // not ours: native menu
				}
				e.preventDefault();
				menu = {
					x: e.clientX,
					y: e.clientY,
					addr: '',
					name: ident,
					ident: ident || undefined,
					line
				};
				return;
			}
			e.preventDefault();
			menu = { x: e.clientX, y: e.clientY, addr, name: hit?.dataset.name ?? '', line, row };
		};
		window.addEventListener('contextmenu', onMenu);
		return () => window.removeEventListener('contextmenu', onMenu);
	});

	$effect(() => {
		if (!menu) return;
		const close = () => (menu = null);
		// Only dismiss on presses *outside* the menu: closing on any mousedown
		// unmounts the button before its click can fire, which makes every item
		// look like it does nothing but close the menu.
		const onDown = (e: MouseEvent) => {
			if (!el || !el.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
		const onScroll = (e: Event) => {
			if (!el || !el.contains(e.target as Node)) close();
		};
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		window.addEventListener('resize', close);
		window.addEventListener('blur', close);
		document.addEventListener('scroll', onScroll, true);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', close);
			window.removeEventListener('blur', close);
			document.removeEventListener('scroll', onScroll, true);
		};
	});

	// keep the menu inside the viewport
	$effect(() => {
		const m = menu;
		const node = el;
		if (!m || !node) return;
		const r = node.getBoundingClientRect();
		const x = Math.min(m.x, window.innerWidth - r.width - 4);
		const y = Math.min(m.y, window.innerHeight - r.height - 4);
		if (x !== m.x || y !== m.y) menu = { ...m, x: Math.max(4, x), y: Math.max(4, y) };
	});

	function urlFor(addr: string) {
		// same rule as every other job link: the screen decides the front end
		return new URL(`${device.job(session.id)}?a=${encodeURIComponent(addr)}`, location.href).href;
	}

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

	/** Copy the highlighted rows (or the right-clicked one) in one of the
	    listing's three shapes: as shown, bytes only, or everything but bytes. */
	function copyLines(t: Target, kind: CopyKind, what: string) {
		const text = asmSel.format(kind, t.addr);
		if (!text) return;
		const n = text.split('\n').length;
		copy(text, `${n} line${n === 1 ? '' : 's'} of ${what}`);
	}

	/**
	 * Mark the instructions behind a decompiled line and show them. The
	 * decompiler owns the mapping; this only asks for it. A line that Ghidra
	 * mapped to nothing says so rather than switching to a listing that would
	 * look unchanged.
	 */
	async function toAsm(line: number) {
		if (await asmMark.goto(line)) session.tab = 'disasm';
		else plugins.notify('guttex', `line ${line} maps to no instructions`, 'warn');
	}

	/**
	 * The same move from the graph. An instruction inside the function on
	 * screen is marked and the *function* is opened -- the listing is fetched
	 * per function, so selecting the instruction's own address would ask for a
	 * function that does not start there and land on "not a function address".
	 * A target that leaves the function is a plain navigation.
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

	/**
	 * Close, then act on the target we captured *before* closing. Reading
	 * `menu` inside the callback would dereference null -- the menu is already
	 * gone by then.
	 */
	function act(fn: (t: Target) => void) {
		const t = menu;
		menu = null;
		if (t) fn(t);
	}
</script>

{#if menu}
	<div
		class="menu"
		bind:this={el}
		style:left="{menu.x}px"
		style:top="{menu.y}px"
		role="menu"
		tabindex="-1"
	>
		<div class="head mono">
			{#if menu.ident}
				{shownName}
			{:else if menu.addr}
				{displayAddr(menu.addr) + (shownName ? ` ${shownName}` : '')}
			{:else}
				line {menu.line}
			{/if}
		</div>
		{#if menu.row && menu.row === menu.addr}
			<!-- In the listing, an instruction's own row edits its bytes: the name
			     of a thing is what the other views are for. -->
			<button role="menuitem" onclick={() => act((t) => editAt(session.project, t.row!))}>
				edit{selCount > 1 ? ` (${selCount} lines)` : ''}
			</button>
		{:else if menu.ident || menu.addr}
			<button
				role="menuitem"
				onclick={() =>
					act((t) =>
						t.ident
							? renameLocal(session.project, session.addr, t.ident)
							: renameSymbol(session.project, t.addr, t.name)
					)}
			>
				rename{menu.ident ? ' variable' : ''}<span class="key">n</span>
			</button>
		{/if}
		{#if menu.line}
			<button role="menuitem" onclick={() => act((t) => toAsm(t.line!))}>
				go to disassembly
			</button>
		{/if}
		{#if menu.addr && !menu.line && session.tab !== 'disasm'}
			<button role="menuitem" onclick={() => act(toAsmAddr)}>go to disassembly</button>
		{/if}
		{#if menu.addr}
			<div class="sep"></div>
			<button role="menuitem" onclick={() => act((t) => session.select(t.addr))}>open</button>
			<button
				role="menuitem"
				onclick={() => act((t) => window.open(urlFor(t.addr), '_blank', 'noopener'))}
			>
				open in new tab
			</button>
			<div class="sep"></div>
			<button role="menuitem" onclick={() => act((t) => copy(displayAddr(t.addr)))}>
				copy address
			</button>
		{/if}
		{#if shownName}
			<button role="menuitem" onclick={() => copy(shownName)}>copy name</button>
		{/if}
		{#if selCount}
			<div class="sep"></div>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'full', 'listing'))}>
				copy selection{selCount > 1 ? ` (${selCount} lines)` : ''}
			</button>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'addr', 'addresses'))}>
				copy selection address
			</button>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'hex', 'bytes'))}>
				copy selection hex
			</button>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'asm', 'asm'))}>
				copy selection asm
			</button>
		{/if}
		<div class="sep"></div>
		<button
			role="menuitem"
			title="the next right-click here opens the browser's own menu"
			onclick={() =>
				act(() => {
					bypass = true;
					plugins.notify('guttex', 'right-click again for the browser menu');
				})}
		>
			browser default
		</button>
		<div class="hint">shift+right-click always</div>
	</div>
{/if}

<style>
	.menu {
		position: fixed;
		z-index: 80;
		min-width: 190px;
		padding: 4px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
		display: flex;
		flex-direction: column;
	}
	.head {
		padding: 5px 8px 6px;
		font-size: 11px;
		color: var(--fg-dim);
		border-bottom: 1px solid var(--border-soft);
		margin-bottom: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.menu button {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		text-align: left;
		text-transform: none;
		letter-spacing: 0;
		background: transparent;
		border: none;
		padding: 5px 8px;
		font-size: 12px;
	}
	.menu button:hover {
		background: var(--row-sel);
		color: #fff;
	}
	.sep {
		height: 1px;
		margin: 4px 0;
		background: var(--border-soft);
	}
	.key {
		margin-left: auto;
		padding-left: 12px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 11px;
	}
	.hint {
		padding: 4px 8px 2px;
		font-size: 10px;
		color: var(--fg-faint);
	}
</style>
