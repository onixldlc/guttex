<script lang="ts">
	// The one rename prompt. Mounted once per route; everything that can be
	// renamed opens it through `renamer`.
	//
	// It also owns the `n` shortcut, Cutter's, which renames the function you
	// are looking at without having to find something to right-click.
	import { renamer } from '$lib/state/renamer.svelte';
	import { renames } from '$lib/state/renames.svelte';
	import { session } from '$lib/state/session.svelte';
	import { renameSymbol } from '$lib/rename';

	let value = $state('');
	let field = $state<HTMLInputElement | null>(null);

	// A fresh prompt starts from the name on screen, selected, so typing
	// replaces it and Enter alone is a no-op.
	$effect(() => {
		const a = renamer.ask;
		if (!a) return;
		value = a.current;
		queueMicrotask(() => field?.select());
	});

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const a = renamer.ask;
		if (!a) return;
		renamer.close();
		a.apply(value);
	}

	function revert() {
		const a = renamer.ask;
		if (!a) return;
		renamer.close();
		a.apply(a.original);
	}

	function typing(t: EventTarget | null) {
		const el = t as HTMLElement | null;
		if (!el) return false;
		return (
			el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' ||
			el.isContentEditable
		);
	}

	function onKey(e: KeyboardEvent) {
		if (renamer.ask) {
			if (e.key === 'Escape') renamer.close();
			return;
		}
		if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
		if (!session.addr) return;
		e.preventDefault();
		renameSymbol(session.project, session.addr, session.fn?.name ?? '');
	}
</script>

<svelte:window onkeydown={onKey} />

{#if renamer.ask}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => renamer.close()}></div>
	<div class="box" role="dialog" aria-label="rename">
		<div class="what">{renamer.ask.what}</div>
		<form onsubmit={submit}>
			<input class="mono" bind:this={field} bind:value aria-label="new name" spellcheck="false" />
			<button class="primary" type="submit">rename</button>
		</form>
		<div class="foot">
			{#if renamer.ask.current !== renamer.ask.original}
				<span class="dim mono">ghidra: {renamer.ask.original}</span>
				<button class="flat" onclick={revert}>restore</button>
			{:else}
				<span class="dim">applies everywhere this name is shown</span>
			{/if}
			<span class="spacer"></span>
			<span class="dim small">{renames.count(session.project)} renamed</span>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgb(0 0 0 / 35%);
	}
	.box {
		position: fixed;
		z-index: 91;
		/* high enough to clear a phone keyboard, centred on a desktop */
		top: 18vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(440px, calc(100vw - 24px));
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 5px;
		box-shadow: 0 12px 40px rgb(0 0 0 / 55%);
	}
	.what {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-dim);
	}
	form {
		display: flex;
		gap: 8px;
	}
	form input {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 16px;
		padding: 7px 9px;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}
	.foot button {
		padding: 2px 7px;
		font-size: 11px;
	}
	.small {
		color: var(--fg-faint);
	}
</style>
