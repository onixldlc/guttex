<script lang="ts">
	// Right-click menu for anything that carries an address (`data-addr`):
	// function rows, jump/call targets, xrefs. Right-clicking anywhere else is
	// left alone -- the browser's own menu is the correct menu for ordinary page
	// chrome, and stealing it everywhere is what makes web apps annoying.
	//
	// Escape hatches, because a hijacked right-click must always be recoverable:
	// shift+right-click never opens this menu, and "browser default" arms the
	// next right-click to pass straight through.
	//
	// What this file no longer holds is the list of what the menu offers. That
	// is `$lib/commands`, shared with the title bar and the phone sheet; here it
	// is filtered by the thing under the pointer and drawn as a stack of rows
	// with a separator between groups.
	import { plugins } from '$lib/plugins/host.svelte';
	import { displayAddr, normAddr } from '$lib/format';
	import { groupedFor, shownName, type Target } from '$lib/commands';
	import { dismissable } from '$lib/actions/dismissable';

	// `ident` is set for a decompiler identifier that resolved to no address --
	// a local. `line` is set anywhere inside a decompiled line, address or not:
	// a line of C is a target in its own right, because it has instructions
	// behind it even when the token under the pointer is punctuation.
	type Placed = Target & { x: number; y: number };

	let menu = $state<Placed | null>(null);
	let el = $state<HTMLElement | null>(null);
	let bypass = $state(false);

	const groups = $derived(menu ? groupedFor('context', { target: menu }) : []);
	const title = $derived(shownName(menu));

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

	/**
	 * Close, then act on the target we captured *before* closing. Reading
	 * `menu` inside the callback would dereference null -- the menu is already
	 * gone by then.
	 */
	function act(run: (t: Target) => void) {
		const t = menu;
		menu = null;
		if (t) run(t);
	}
</script>

{#if menu}
	<div
		class="menu"
		bind:this={el}
		use:dismissable={{ onclose: () => (menu = null), volatile: true }}
		style:left="{menu.x}px"
		style:top="{menu.y}px"
		role="menu"
		tabindex="-1"
	>
		<div class="head mono">
			{#if menu.ident}
				{title}
			{:else if menu.addr}
				{displayAddr(menu.addr) + (title ? ` ${title}` : '')}
			{:else}
				line {menu.line}
			{/if}
		</div>

		{#each groups as group, gi (group[0].id)}
			{#if gi > 0}<div class="sep"></div>{/if}
			{#each group as c (c.id)}
				<button role="menuitem" onclick={() => act((t) => c.run({ target: t }))}>
					{c.label({ target: menu })}
					{#if c.hint}<span class="key">{c.hint}</span>{/if}
				</button>
			{/each}
		{/each}

		<div class="sep"></div>
		<!-- Not a command: it is about this menu, not about the program. -->
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
