<script lang="ts">
	// Dock tab bar that collapses instead of clipping. Tabs that no longer fit
	// move into a trailing "..." menu; the active tab is never the one hidden.
	//
	// Widths come from an off-layout ruler holding every tab, so measurement is
	// independent of what is currently on screen -- measuring the live tabs
	// would feed the layout back into its own input and oscillate.
	import type { Tab } from './tabs';

	let {
		tabs,
		active = $bindable(),
		label = 'tabs'
	}: { tabs: Tab[]; active: string; label?: string } = $props();

	const MORE_W = 36;

	let strip = $state<HTMLDivElement | null>(null);
	let ruler = $state<HTMLDivElement | null>(null);
	let menu = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let widths = $state<number[]>([]);
	let open = $state(false);

	$effect(() => {
		const el = strip;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			width = entries[0].contentRect.width;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		const el = ruler;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			widths = Array.from(el.querySelectorAll<HTMLElement>('[data-rule]'), (e) => e.offsetWidth);
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	function fit(avail: number): number {
		let used = 0;
		for (let i = 0; i < tabs.length; i++) {
			used += widths[i] ?? 0;
			if (used > avail) return i;
		}
		return tabs.length;
	}

	let visibleCount = $derived.by(() => {
		if (widths.length !== tabs.length || !width) return tabs.length;
		const all = fit(width);
		// once anything overflows, the menu button costs width too
		return all === tabs.length ? all : fit(width - MORE_W);
	});

	let shown = $derived.by(() => {
		const list = tabs.slice(0, Math.max(visibleCount, 0));
		const i = tabs.findIndex((t) => t.id === active);
		if (i >= 0 && i >= list.length) {
			// the active tab always stays reachable: it takes the last slot
			if (list.length) list[list.length - 1] = tabs[i];
			else list.push(tabs[i]);
		}
		return list;
	});

	let hidden = $derived(tabs.filter((t) => !shown.some((s) => s.id === t.id)));

	function pick(id: string) {
		active = id;
		open = false;
	}

	function outside(e: PointerEvent) {
		if (!open) return;
		const t = e.target as Node;
		if (menu && !menu.contains(t)) open = false;
	}
</script>

<svelte:window
	onpointerdown={outside}
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
/>

<div class="strip" bind:this={strip} role="tablist" aria-label={label}>
	<!-- off-layout copy used only for measurement -->
	<div class="ruler" aria-hidden="true" bind:this={ruler}>
		{#each tabs as t (t.id)}
			<span class="tab" data-rule>{t.label}</span>
		{/each}
	</div>

	{#each shown as t (t.id)}
		<button
			class="tab"
			class:on={active === t.id}
			role="tab"
			aria-selected={active === t.id}
			onclick={() => (active = t.id)}
		>
			{t.label}
		</button>
	{/each}

	{#if hidden.length}
		<div class="more" bind:this={menu}>
			<button
				class="tab dots"
				class:on={hidden.some((t) => t.id === active)}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="{hidden.length} more tabs"
				onclick={() => (open = !open)}
			>
				&#8943;
			</button>
			{#if open}
				<ul class="menu" role="menu">
					{#each hidden as t (t.id)}
						<li>
							<button role="menuitem" class:on={active === t.id} onclick={() => pick(t.id)}>
								{t.label}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.strip {
		display: flex;
		align-items: stretch;
		min-width: 0;
		flex: 1 1 auto;
		position: relative;
		height: 100%;
	}
	.ruler {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		visibility: hidden;
		pointer-events: none;
		height: 100%;
	}
	.tab {
		flex: none;
		border: none;
		border-right: 1px solid var(--border);
		border-bottom: 2px solid transparent;
		border-radius: 0;
		background: transparent;
		color: var(--fg-dim);
		height: 100%;
		padding: 0 10px;
		font-size: 11px;
		font-family: var(--ui);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
	}
	.tab:hover:not(:disabled) {
		background: var(--bg-elev);
		color: var(--fg);
	}
	.tab.on {
		color: var(--fg);
		background: var(--bg-panel);
		border-bottom-color: var(--accent);
	}
	.dots {
		font-size: 15px;
		letter-spacing: 0;
		padding: 0 9px;
		/* fills whatever slack is left after the visible tabs, so the strip has
		   no dead gap between the last tab and the dock edge */
		width: 100%;
		justify-content: center;
	}
	.more {
		position: relative;
		flex: 1 1 auto;
		min-width: 36px;
		display: flex;
	}
	.menu {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 20;
		margin: 0;
		padding: 3px;
		list-style: none;
		min-width: 130px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 3px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
	}
	.menu button {
		display: block;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		color: var(--fg-dim);
		padding: 4px 9px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: 2px;
	}
	.menu button:hover {
		background: var(--accent-dim);
		color: #fff;
	}
	.menu button.on {
		color: var(--fg);
	}
</style>
