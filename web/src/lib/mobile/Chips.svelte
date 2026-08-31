<script lang="ts">
	// Tab bar for the phone: one scrolling row of chips. The desktop TabStrip
	// measures itself and folds what does not fit into a "..." menu; here the
	// bar just scrolls, because flicking a row is cheaper than a second tap.
	import type { Tab } from '$components/tabs';

	let {
		tabs,
		active = $bindable(),
		label = 'tabs'
	}: { tabs: Tab[]; active: string; label?: string } = $props();

	let strip = $state<HTMLDivElement | null>(null);

	// A tab can be selected by something other than a tap -- following a call
	// target switches to disassembly -- and that chip may be off-screen. Drag
	// it back into view so the bar never looks stuck on the wrong tab.
	$effect(() => {
		void active;
		strip?.querySelector('.m-tab.on')?.scrollIntoView({
			block: 'nearest',
			inline: 'center',
			behavior: 'smooth'
		});
	});
</script>

<div class="m-tabs" bind:this={strip} role="tablist" aria-label={label}>
	{#each tabs as t (t.id)}
		<button
			class="m-tab"
			class:on={active === t.id}
			role="tab"
			aria-selected={active === t.id}
			onclick={() => (active = t.id)}
		>
			{t.label}
		</button>
	{/each}
</div>
