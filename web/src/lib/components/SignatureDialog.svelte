<script lang="ts">
	// The prototype prompt: Ghidra's "Edit Function Signature", reached over
	// HTTP. Mounted once per route, opened through `signer`.
	//
	// It owns the `f` shortcut -- Ghidra's key for the same dialog -- which
	// retypes the function you are looking at.
	//
	// Unlike the rename prompt this one blocks. ghidra-rest has to re-open the
	// analysis project and run the decompiler again, which takes tens of
	// seconds, so the dialog stays up with a progress line instead of closing
	// optimistically. Closing early would leave the old C on screen with no
	// sign that anything was happening.
	import { signer } from '$lib/state/signature.svelte';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr } from '$lib/format';

	let field = $state<HTMLInputElement | null>(null);
	let elapsed = $state(0);
	// The convention is a property of this prompt, not of the edit: it resets
	// with the dialog and is only sent when someone actually typed one.
	let ccDraft = $state('');

	// A fresh prompt starts from the prototype on screen, selected, so typing
	// replaces it and Enter alone is a no-op.
	$effect(() => {
		if (!signer.ask) return;
		ccDraft = '';
		queueMicrotask(() => field?.select());
	});

	// The wait is long enough that a static "working..." reads as a hang.
	$effect(() => {
		if (!signer.busy) {
			elapsed = 0;
			return;
		}
		const t0 = Date.now();
		const h = setInterval(() => (elapsed = Math.round((Date.now() - t0) / 1000)), 250);
		return () => clearInterval(h);
	});

	let edited = $derived(!!signer.ask && signer.edited(signer.ask.addr));

	function submit(e: SubmitEvent) {
		e.preventDefault();
		void signer.apply(ccDraft);
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

	function openHere() {
		if (!session.id || !session.addr || !session.fn) return;
		signer.open({
			job: session.id,
			addr: session.addr,
			name: session.fn.name,
			current: session.fn.signature ?? ''
		});
	}

	function onKey(e: KeyboardEvent) {
		if (signer.ask) {
			if (e.key === 'Escape' && !signer.busy) signer.close();
			return;
		}
		if (e.key !== 'f' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
		if (!session.addr || !session.fn) return;
		e.preventDefault();
		openHere();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if signer.ask}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => signer.close()}></div>
	<div class="box" role="dialog" aria-label="edit function signature">
		<div class="what">
			function signature
			<span class="dim mono">{signer.ask.name} @ {displayAddr(signer.ask.addr)}</span>
		</div>

		<form onsubmit={submit}>
			<input
				class="mono proto"
				bind:this={field}
				bind:value={signer.draft}
				aria-label="prototype"
				spellcheck="false"
				disabled={signer.busy || !signer.editable}
			/>
			<div class="row">
				<label class="cc">
					<span class="dim">convention</span>
					<input
						class="mono"
						list="guttex-cc"
						placeholder="leave as is"
						aria-label="calling convention"
						spellcheck="false"
						disabled={signer.busy || !signer.editable}
						bind:value={ccDraft}
					/>
				</label>
				<span class="spacer"></span>
				<button class="primary" type="submit" disabled={signer.busy || !signer.editable}>
					{signer.busy ? 'applying...' : 'apply'}
				</button>
			</div>
		</form>

		<!-- Only what this program's compiler spec defines. Ghidra stores an
		     unrecognised name without complaint and then prints "Unknown calling
		     convention" over the result, so guessing here would be worse than
		     offering nothing; when the server has no list the field stays free
		     text and the server rejects a bad name by naming the good ones. -->
		<datalist id="guttex-cc">
			{#each signer.conventions as cc (cc)}<option value={cc}></option>{/each}
		</datalist>

		{#if !signer.editable}
			<p class="note err">
				this analysis cannot be retyped: {signer.blocked || 'no Ghidra project was kept'}
			</p>
		{:else if signer.busy}
			<p class="note">
				<span class="spin" aria-hidden="true"></span>
				ghidra is re-opening the project and decompiling this function and its callers
				{#if elapsed}<span class="dim">&mdash; {elapsed}s</span>{/if}
			</p>
		{:else if signer.error}
			<p class="note err">{signer.error}</p>
		{:else}
			<p class="note dim">
				C, the same text Ghidra's Edit Function Signature takes. The name is ignored &mdash; use
				rename for that.
			</p>
		{/if}

		<div class="foot">
			{#if edited}
				<span class="dim mono ghidra">ghidra: {signer.originalOf(signer.ask.addr)}</span>
				<button class="flat" disabled={signer.busy} onclick={() => signer.reset()}>reset</button>
			{:else}
				<span class="dim small">applies inside ghidra, not just in guttex</span>
			{/if}
			<span class="spacer"></span>
			<button class="flat" disabled={signer.busy} onclick={() => signer.close()}>close</button>
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
		top: 18vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(620px, calc(100vw - 24px));
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
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-dim);
	}
	.what .mono {
		text-transform: none;
		letter-spacing: 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.proto {
		width: 100%;
		font-size: 15px;
		padding: 7px 9px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cc {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}
	.cc input {
		width: 140px;
		padding: 4px 7px;
		font-size: 12px;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0;
		font-size: 11.5px;
		line-height: 1.45;
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
	.ghidra {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 60%;
	}
	.small {
		color: var(--fg-faint);
	}
	.spin {
		flex: 0 0 auto;
		width: 11px;
		height: 11px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation-duration: 2.4s;
		}
	}
</style>
