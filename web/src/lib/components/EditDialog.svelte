<script lang="ts">
	// Editing the bytes at an address. Mounted once per route, opened from the
	// listing's right-click menu through `patchEditor`.
	//
	// Two ways to say the same thing: type hex and the box below shows the
	// instructions it becomes, or type assembly and the box shows the bytes it
	// becomes. Either way what gets recorded is hex -- the patch log holds
	// bytes and nothing else, so assembly is assembled before it is stored.
	//
	// And nothing is written to the binary here. Applying adds a line to the
	// project's patch log; the file only changes when it is exported.
	import { store, type AsmAnswer } from '$lib/api/store';
	import { archOf } from '$lib/arch';
	import { displayAddr } from '$lib/format';
	import { patchEditor } from '$lib/state/editor.svelte';
	import { normAob, renames } from '$lib/state/renames.svelte';
	import { session } from '$lib/state/session.svelte';

	type Mode = 'hex' | 'asm';

	let mode = $state<Mode>('hex');
	// Kept apart, so flipping the switch shows what this address says in the
	// other language instead of the same characters in a box that rejects them.
	let hexText = $state('');
	let asmText = $state('');
	let answer = $state<AsmAnswer | null>(null);
	let busy = $state(false);
	let field = $state<HTMLInputElement | null>(null);

	const typed = $derived(mode === 'hex' ? hexText : asmText);
	/** what would be written: hex as typed, or the assembler's bytes */
	const outHex = $derived(mode === 'hex' ? normAob(hexText) : (answer?.ok ? (answer.hex ?? '') : ''));
	const outLen = $derived(outHex ? outHex.split(' ').length : 0);
	const wasLen = $derived(patchEditor.ask?.bytes ? patchEditor.ask.bytes.split(' ').length : 0);
	const bad = $derived(mode === 'hex' && hexText.trim() !== '' && !outHex);

	// A fresh prompt starts from what is at the address, selected, so typing
	// replaces it and closing without typing changes nothing.
	$effect(() => {
		const a = patchEditor.ask;
		if (!a) return;
		hexText = a.bytes;
		asmText = a.asm;
		mode = 'hex';
		answer = null;
		queueMicrotask(() => field?.select());
	});

	// The preview. Every keystroke asks the server, which is where keystone and
	// capstone live; the wait is short enough to leave the box live rather than
	// putting a "translate" button in front of it.
	$effect(() => {
		const a = patchEditor.ask;
		const m = mode;
		const text = typed;
		if (!a) return;
		if (!text.trim()) {
			answer = null;
			return;
		}
		let alive = true;
		busy = true;
		const t = setTimeout(async () => {
			try {
				const r = await store.translate({ mode: m, text, addr: a.addr, ...archOf() });
				if (alive) answer = r;
			} catch (e) {
				if (alive) answer = { ok: false, error: e instanceof Error ? e.message : String(e) };
			} finally {
				if (alive) busy = false;
			}
		}, 160);
		return () => {
			alive = false;
			clearTimeout(t);
		};
	});

	/** the read-only box: the other half of whatever was typed */
	const result = $derived.by(() => {
		if (!typed.trim()) return '';
		if (bad) return 'not whole hex bytes';
		if (!answer) return busy ? '...' : '';
		if (!answer.ok) return answer.error ?? 'no';
		if (mode === 'asm') return answer.hex ?? '';
		const lines = (answer.lines ?? []).map((l) => `${displayAddr(l.addr)}  ${l.text}`);
		if (answer.trailing) lines.push(`+ ${answer.trailing} byte(s) that are not an instruction`);
		return lines.join('\n') || 'nothing decodes here';
	});

	function apply(e: SubmitEvent) {
		e.preventDefault();
		const a = patchEditor.ask;
		if (!a || !outHex) return;
		patchEditor.close();
		renames.setPatch(session.project, a.addr, outHex);
	}

	function drop() {
		const a = patchEditor.ask;
		if (!a) return;
		patchEditor.close();
		renames.delPatch(session.project, a.addr);
	}

	function onKey(e: KeyboardEvent) {
		if (patchEditor.ask && e.key === 'Escape') patchEditor.close();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if patchEditor.ask}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => patchEditor.close()}></div>
	<div class="box" role="dialog" aria-label="edit instruction">
		<div class="what">
			edit at {displayAddr(patchEditor.ask.addr)}
			{#if patchEditor.ask.rows > 1}<span class="dim"> · {patchEditor.ask.rows} instructions</span
				>{/if}
		</div>

		<div class="switch" role="group" aria-label="input as">
			<button class:on={mode === 'hex'} onclick={() => (mode = 'hex')}>input as hex</button>
			<button class:on={mode === 'asm'} onclick={() => (mode = 'asm')}>input as asm</button>
		</div>

		<form onsubmit={apply}>
			{#if mode === 'hex'}
				<input
					class="mono"
					bind:this={field}
					bind:value={hexText}
					aria-label="bytes"
					placeholder="90 90 90"
					spellcheck="false"
					autocomplete="off"
				/>
			{:else}
				<input
					class="mono"
					bind:value={asmText}
					aria-label="assembly"
					placeholder="xor eax, eax; ret"
					spellcheck="false"
					autocomplete="off"
				/>
			{/if}
			<button class="primary" type="submit" disabled={!outHex}>apply</button>
		</form>

		<label class="lab" for="edit-result">
			{mode === 'hex' ? 'reads as' : 'writes'}
			{#if busy}<span class="dim"> ...</span>{/if}
		</label>
		<textarea id="edit-result" class="mono out" class:err={bad || answer?.ok === false} readonly
			>{result}</textarea
		>

		<div class="foot">
			{#if outLen}
				<span class="dim mono">{outLen} byte{outLen === 1 ? '' : 's'}</span>
				{#if wasLen && outLen !== wasLen}
					<span class="warn">
						{outLen > wasLen
							? `${outLen - wasLen} past the selection`
							: `${wasLen - outLen} byte(s) left as they were`}
					</span>
				{/if}
			{:else}
				<span class="dim">the binary is not touched -- this is a patch log entry</span>
			{/if}
			<span class="spacer"></span>
			{#if patchEditor.ask.patched}
				<button class="flat" onclick={drop}>remove patch</button>
			{/if}
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
		top: 16vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(520px, calc(100vw - 24px));
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
	.switch {
		display: flex;
		gap: 0;
	}
	.switch button {
		flex: 1 1 0;
		padding: 5px 8px;
		font-size: 11px;
		border-radius: 0;
	}
	.switch button:first-child {
		border-radius: 4px 0 0 4px;
	}
	.switch button:last-child {
		border-radius: 0 4px 4px 0;
		border-left: none;
	}
	.switch button.on {
		background: var(--row-sel);
		color: #fff;
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
	.lab {
		font-size: 11px;
		color: var(--fg-dim);
	}
	.out {
		min-height: 76px;
		resize: vertical;
		padding: 7px 9px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--fg-dim);
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
	}
	.out.err {
		color: var(--warn, #d9822b);
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
	.warn {
		color: var(--warn, #d9822b);
	}
</style>
