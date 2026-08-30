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
	import { asmSel, type CopyKind } from '$lib/state/asmsel.svelte';

	type Target = { x: number; y: number; addr: string; name: string };

	let menu = $state<Target | null>(null);
	let el = $state<HTMLElement | null>(null);
	let bypass = $state(false);

	// Rows a copy would take: the highlighted block, or the single row that was
	// right-clicked. Zero when the target is not a listing row at all, which is
	// what hides the copy items on a function or xref row.
	const selCount = $derived(menu ? asmSel.rows(menu.addr).length : 0);

	$effect(() => {
		const onMenu = (e: MouseEvent) => {
			if (bypass || e.shiftKey) {
				bypass = false;
				menu = null;
				return; // native menu
			}
			const hit = (e.target as HTMLElement | null)?.closest?.('[data-addr]') as HTMLElement | null;
			const addr = normAddr(hit?.dataset.addr ?? '');
			if (!addr) {
				menu = null;
				return; // not ours: native menu
			}
			e.preventDefault();
			menu = { x: e.clientX, y: e.clientY, addr, name: hit?.dataset.name ?? '' };
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
		return new URL(`/j/${session.id}?a=${encodeURIComponent(addr)}`, location.href).href;
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
			{displayAddr(menu.addr)}{menu.name ? ` ${menu.name}` : ''}
		</div>
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
		{#if menu.name}
			<button role="menuitem" onclick={() => act((t) => copy(t.name))}>copy name</button>
		{/if}
		<button role="menuitem" onclick={() => act((t) => copy(urlFor(t.addr)))}>copy link</button>
		{#if selCount}
			<div class="sep"></div>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'full', 'listing'))}>
				copy selection{selCount > 1 ? ` (${selCount} lines)` : ''}
			</button>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'hex', 'bytes'))}>
				copy hex
			</button>
			<button role="menuitem" onclick={() => act((t) => copyLines(t, 'asm', 'asm'))}>
				copy asm
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
	.hint {
		padding: 4px 8px 2px;
		font-size: 10px;
		color: var(--fg-faint);
	}
</style>
