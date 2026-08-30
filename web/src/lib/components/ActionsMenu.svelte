<script lang="ts">
	// Plugin commands for the current selection. Hidden entirely when no plugin
	// contributes one, so a stock guttex shows no dead chrome.
	import { plugins } from '$lib/plugins/host.svelte';
	import { session } from '$lib/state/session.svelte';

	let open = $state(false);
	let box = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (box && !box.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	});

	function run(key: string) {
		open = false;
		plugins.run(key);
	}
</script>

{#if plugins.actions.length}
	<div class="wrap" bind:this={box}>
		<button class="flat trigger" aria-expanded={open} onclick={() => (open = !open)}>
			actions
		</button>
		{#if open}
			<ul class="menu">
				{#each plugins.actions as a (a.key)}
					<li>
						<button
							class="flat item"
							disabled={a.spec.needs === 'address' && !session.addr}
							title={a.plugin.manifest?.name}
							onclick={() => run(a.key)}
						>
							{a.label}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		position: relative;
		display: flex;
	}
	.trigger {
		font-size: 11px;
	}
	.menu {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 30;
		margin: 2px 0 0;
		padding: 4px;
		list-style: none;
		min-width: 180px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 45%);
	}
	.item {
		width: 100%;
		justify-content: flex-start;
		text-align: left;
		text-transform: none;
		letter-spacing: 0;
	}
</style>
