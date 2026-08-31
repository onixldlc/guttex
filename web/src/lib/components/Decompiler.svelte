<script lang="ts">
	// Center view: the decompiled C for whatever address is selected, tokenized
	// and rendered as spans -- never `{@html}`.
	//
	// Double-click a name to go to it, the way every other view here navigates.
	//
	// Ghidra names every stack slot `local_128` and every unnamed function
	// `FUN_00101250`. Those names are not edited here as text: right-click one
	// and guttex renames the *symbol*, which repaints the function list, the
	// listing, the graphs and the xrefs at the same time. See
	// `state/renames.svelte.ts`.
	//
	// Hovering a line shows the instructions behind it; clicking its number
	// carries the same set to the disassembly tab, lit.
	import { api, ApiError } from '$lib/api/client';
	import type { Decompiled, DisasmListing, Instruction } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr, normAddr, tokenizeC, type Tok } from '$lib/format';
	import { mnemonicClass, tokenizeAsm } from '$lib/asmtok';
	import { addrInName, aliasName, dispName, localName } from '$lib/state/renames.svelte';
	import { operandName } from '$lib/state/book.svelte';
	import { plugins } from '$lib/plugins/host.svelte';
	import { signer } from '$lib/state/signature.svelte';
	import { indexAsm, mapLine, type AsmIndex, type Hit } from '$lib/decomp/asmmap';
	import { asmMark } from '$lib/state/asmmark.svelte';
	import { scrolls } from '$lib/state/scrollmem';
	import { tick } from 'svelte';

	let data = $state<Decompiled | null>(null);
	let loading = $state(false);
	let error = $state('');

	let listing = $state<DisasmListing | null>(null);
	let asmFor = ''; // which address `listing` belongs to

	$effect(() => {
		const addr = session.addr;
		const id = session.id;
		// Read so a retype repaints: the server re-decompiled this function and
		// its callers, so whatever is on screen is now the old text.
		signer.rev;
		if (!id || !addr) {
			data = null;
			return;
		}
		let stale = false;
		loading = true;
		error = '';
		api
			.decompile(id, addr)
			.then((d) => {
				if (!stale) data = d;
			})
			.catch((e) => {
				if (stale) return;
				data = null;
				error =
					e instanceof ApiError && e.notReady
						? 'analysis still running'
						: e instanceof Error
							? e.message
							: String(e);
			})
			.finally(() => {
				if (!stale) loading = false;
			});
		return () => {
			stale = true;
		};
	});

	// ------------------------------------------------------------------ lines

	let lines = $derived.by(() => (data?.c ?? '').split('\n').map((l) => tokenizeC(l)));
	/** line numbers Ghidra mapped to at least one instruction */
	let mapped = $derived(new Set((data?.lines ?? []).map((l) => l.n)));

	/** entry address of the function on screen; the scope for local renames */
	let fnAddr = $derived(normAddr(data?.address ?? session.addr));

	/**
	 * What an identifier in this buffer refers to. Callees are listed on the
	 * function artifact, and Ghidra's auto names carry their own address
	 * (`FUN_00101250`, `DAT_00104010`), so a symbol resolves without a lookup
	 * table. Everything else is a local, scoped to this function.
	 */
	let symOfName = $derived.by(() => {
		const m = new Map<string, string>();
		if (data) m.set(data.name, normAddr(data.address));
		for (const c of session.fn?.calls ?? []) m.set(c.name, normAddr(c.address));
		return m;
	});

	function resolve(ident: string): string {
		return symOfName.get(ident) ?? addrInName(ident);
	}

	const ident = (tok: Tok) => (tok.c === 'id' || tok.c === 'fn' ? tok.t : undefined);
	/** a resolved identifier also carries its address, so the right-click menu
	    can open it and copy a link to it like any other address in the app */
	const symAddr = (tok: Tok) => (ident(tok) ? resolve(tok.t) || undefined : undefined);

	/** how a token reads after renames: symbols by name, locals by scope */
	function shown(tok: Tok): string {
		if (tok.c !== 'id' && tok.c !== 'fn') return tok.t;
		const a = aliasName(session.project, tok.t);
		if (a !== tok.t) return a;
		return localName(session.project, fnAddr, tok.t);
	}

	/**
	 * Double-click opens what a name refers to. Renaming is the right-click
	 * menu's job -- it is where every other per-symbol action already lives,
	 * and a double-click that edits instead of navigating is the opposite of
	 * what a disassembler trains your hands to expect.
	 *
	 * A local has no address to go to, and an import has no body in this
	 * binary; neither navigates, because landing on an empty pane reads as a
	 * bug rather than an answer.
	 */
	function onDbl(e: MouseEvent) {
		const hit = (e.target as HTMLElement | null)?.closest?.('[data-id]') as HTMLElement | null;
		const ident = hit?.dataset.id;
		if (!ident) return;
		e.preventDefault();
		const addr = resolve(ident);
		if (!addr) return;
		if (addr.includes(':')) {
			plugins.notify('guttex', `${ident} is imported -- no body in this binary`);
			return;
		}
		session.select(addr);
	}

	// ------------------------------------------------------------------ hover

	type Card = { line: number; x: number; y: number; hits: Hit[]; exact: boolean };
	let card = $state<Card | null>(null);
	let cardW = $state(0);
	let cardH = $state(0);
	let winW = $state(0);
	let winH = $state(0);

	let index = $state<AsmIndex | null>(null);
	let own = $state<Map<string, Instruction>>(new Map());

	/** The listing is only needed once someone hovers, so it is fetched then. */
	async function ensureAsm(): Promise<boolean> {
		const id = session.id;
		const addr = data?.address;
		if (!id || !addr) return false;
		if (asmFor === normAddr(addr) && listing) return true;
		try {
			const l = await api.disasm(id, addr);
			asmFor = normAddr(addr);
			listing = l;
			index = indexAsm(l.instructions);
			own = new Map(l.instructions.map((i) => [normAddr(i.address), i]));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Ghidra records which instructions produced each line of C, and ghidra-rest
	 * serves it as `lines` when the analysis was new enough to export it.
	 * Without that, fall back to matching the text of the line.
	 */
	async function behind(line: number): Promise<{ hits: Hit[]; exact: boolean }> {
		const none = { hits: [] as Hit[], exact: false };
		if (!(await ensureAsm()) || !index) return none;

		const exact = data?.lines?.find((l) => l.n === line);
		if (exact) {
			const hits: Hit[] = [];
			for (const a of exact.a) {
				const ins = own.get(normAddr(a));
				if (ins) hits.push({ ins, why: '' });
			}
			return { hits, exact: true };
		}

		const src = (data?.c ?? '').split('\n')[line - 1] ?? '';
		return { hits: mapLine(src, index), exact: false };
	}

	async function hover(line: number, x: number, y: number) {
		const { hits, exact } = await behind(line);
		// the pointer may have moved on while the listing was being fetched
		card = hits.length ? { line, x, y, hits, exact } : null;
	}

	/**
	 * Same question as the hover card, answered in the listing instead: mark the
	 * instructions this line compiled from and switch to the disassembly tab,
	 * which scrolls to them. No navigation -- they belong to the function that
	 * is already selected.
	 */
	async function toAsm(line: number) {
		if (!(await asmMark.goto(line))) return;
		card = null;
		session.tab = 'disasm';
	}

	// Lend the resolver out while this panel is mounted. The right-click menu
	// is global and has no listing of its own; unpublishing on teardown keeps
	// it from answering for a function that is no longer on screen.
	$effect(() => {
		asmMark.source = async (line: number) => ({
			fn: fnAddr,
			addrs: (await behind(line)).hits.map((h) => h.ins.address)
		});
		return () => (asmMark.source = null);
	});

	// keep the card on screen no matter which corner the pointer is in
	let pos = $derived.by(() => {
		if (!card) return { left: 0, top: 0 };
		const w = cardW || 360;
		const h = cardH || 160;
		const left = card.x + 18 + w > winW ? Math.max(8, card.x - 18 - w) : card.x + 18;
		const top = card.y + 18 + h > winH ? Math.max(8, card.y - 12 - h) : card.y + 18;
		return { left, top };
	});

	// ----------------------------------------------------------------- scroll

	// Where this function was last left off. Saved on every scroll (the store
	// coalesces the writes) and put back when the panel comes up again, which
	// happens on every trip through another centre tab.
	let bodyEl = $state<HTMLElement | undefined>();
	let scrollKey = $derived(session.id && fnAddr ? `${session.id}:${fnAddr}` : '');

	$effect(() => {
		const key = scrollKey;
		const el = bodyEl;
		data?.c; // restore once the text that gives the panel its height is in
		if (!el || !key) return;
		const top = scrolls.get(key);
		if (!top) return;
		// `tick` for the rows, a frame for their layout: scrollTop is clamped to
		// the height the element has *now*, so setting it too early lands at 0.
		tick().then(() =>
			requestAnimationFrame(() => {
				// leave it alone if the reader already moved in the meantime
				if (bodyEl && bodyEl.scrollTop === 0) bodyEl.scrollTop = top;
			})
		);
	});

	// ---------------------------------------------------------------- actions

	/** the signature, carrying the renamed function name */
	let title = $derived.by(() => {
		if (!data) return '';
		const sig = data.signature || data.name;
		const to = dispName(session.project, data.address, data.name);
		return to === data.name ? sig : sig.replace(data.name, to);
	});

	/**
	 * Retyping is not a rename: it goes back into Ghidra and re-runs the
	 * decompiler, so it is offered from the header rather than from the
	 * double-click that edits names. `session.fn` carries the stored prototype;
	 * `data.signature` is the decompiler's rendering of it, which ends in a
	 * semicolon and would round-trip badly.
	 */
	function editSig() {
		if (!session.id || !session.addr) return;
		signer.open({
			job: session.id,
			addr: session.addr,
			name: session.fn?.name ?? data?.name ?? '',
			current: session.fn?.signature ?? ''
		});
	}

	/** copy what is on screen, renames and all -- not the server's text */
	function copy() {
		const text = lines.map((toks) => toks.map(shown).join('')).join('\n');
		if (text) navigator.clipboard?.writeText(text);
	}
</script>

<svelte:window bind:innerWidth={winW} bind:innerHeight={winH} />

<div class="wrap">
	<div class="sub">
		{#if data}
			<span class="mono sig">{title}</span>
			<span class="addr">{displayAddr(data.address)}</span>
			{#if data.ok === false}<span class="err">decompilation failed</span>{/if}
			<span class="spacer"></span>
			<span class="dim hint"
				>double-click a name to open it &middot; right-click to rename &middot; click a line number
				for the listing</span
			>
			<button class="flat" onclick={editSig} title="edit the function signature in ghidra (f)"
				>signature</button
			>
			<button class="flat" onclick={copy}>copy</button>
		{:else}
			<span class="dim">pick a function in the left dock</span>
		{/if}
	</div>

	{#if loading}
		<p class="empty">decompiling...</p>
	{:else if error}
		<p class="empty err">{error}</p>
	{:else if data?.error}
		<p class="empty err">{data.error}</p>
	{:else if data?.c}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="panel-body code"
			bind:this={bodyEl}
			onscroll={() => bodyEl && scrolls.set(scrollKey, bodyEl.scrollTop)}
			onmouseleave={() => (card = null)}
			ondblclick={onDbl}
		>
			<table class="c">
				<tbody>
					{#each lines as toks, i (i)}
						<tr
							class:has={mapped.has(i + 1)}
							data-line={i + 1}
							onmouseenter={(e) => hover(i + 1, e.clientX, e.clientY)}
						>
							<td class="n"
								><button
									class="ln"
									title="show the instructions for this line in the disassembly"
									onclick={() => toAsm(i + 1)}>{i + 1}</button
								></td
							>
							<td class="src"
								>{#each toks as tok, k (k)}<span
										class={tok.c}
										data-id={ident(tok)}
										data-addr={symAddr(tok)}
										data-name={ident(tok)}>{shown(tok)}</span
									>{/each}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if session.addr}
		<p class="empty">no decompiled body for this address</p>
	{:else}
		<p class="empty">nothing selected</p>
	{/if}
</div>

{#if card}
	<div
		class="card"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
		bind:clientWidth={cardW}
		bind:clientHeight={cardH}
	>
		<div class="chead">
			<span>line {card.line}</span>
			<span class="dim">{card.exact ? 'ghidra line map' : 'matched by text'}</span>
		</div>
		<div class="chint">
			<span class="dim">click the line number -- or right-click the line -- for the listing</span>
		</div>
		<table class="asm">
			<tbody>
				{#each card.hits as h (h.ins.address)}
					<tr>
						<td class="a">{displayAddr(h.ins.address)}</td>
						<td class="m {mnemonicClass(h.ins)}">{h.ins.mnemonic}</td>
						<td class="o"
							>{#each tokenizeAsm(h.ins.operands) as tok, k (k)}{@const nm = operandName(
								session.project,
								session.id,
								tok.t,
								h.ins.is_call ? h.ins.flow : undefined
							)}<span class={nm ? 'sym' : tok.c} title={nm ? tok.t : null}
									>{nm || aliasName(session.project, tok.t)}</span
								>{/each}</td
						>
						{#if !card.exact}<td class="why">{h.why}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.sig {
		color: var(--syn-fn);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font-size: 11px;
		white-space: nowrap;
	}
	@media (max-width: 820px) {
		.hint {
			display: none;
		}
	}
	.code {
		background: var(--bg);
	}

	table.c {
		border-collapse: collapse;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.5;
		width: 100%;
	}
	table.c td {
		padding: 0;
		vertical-align: top;
		white-space: pre;
	}
	table.c tbody tr:hover {
		background: var(--row-hover);
	}
	.n {
		width: 1%;
		padding: 0 10px 0 10px !important;
		text-align: right;
		color: var(--fg-faint);
		user-select: none;
	}
	/* a line Ghidra mapped to instructions is a line the hover card can answer */
	tr.has .n {
		color: var(--syn-addr);
	}
	button.ln {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	button.ln:hover {
		color: var(--accent);
		text-decoration: underline;
		background: transparent;
	}
	.src {
		padding-right: 12px !important;
		width: 100%;
	}

	/* tokenizeC's classes */
	.src :global(.key) {
		color: var(--syn-key);
	}
	.src :global(.type) {
		color: var(--syn-type);
	}
	.src :global(.num) {
		color: var(--syn-num);
	}
	.src :global(.str) {
		color: var(--syn-str);
	}
	.src :global(.com) {
		color: var(--syn-com);
	}
	.src :global(.fn) {
		color: var(--syn-fn);
	}
	.src :global(.punct) {
		color: var(--syn-punct);
	}
	.src :global(.id) {
		color: var(--fg);
	}
	/* a renameable token: dotted underline on hover, so it reads as a target
	   without turning the whole listing into a field of links */
	.src :global([data-id]:hover) {
		text-decoration: underline dotted;
		cursor: pointer;
	}

	.card {
		position: fixed;
		z-index: 60;
		max-width: 520px;
		max-height: 40vh;
		overflow: auto;
		padding: 4px 0 6px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 4px;
		box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
		pointer-events: none;
	}
	.chint {
		padding: 3px 10px 0;
		font-size: 10px;
		color: var(--fg-faint);
	}
	.chead {
		display: flex;
		gap: 10px;
		justify-content: space-between;
		padding: 2px 10px 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-dim);
		border-bottom: 1px solid var(--border-soft);
	}
	table.asm {
		border-collapse: collapse;
		font-family: var(--mono);
		font-size: 11.5px;
		line-height: 1.5;
		margin-top: 4px;
	}
	table.asm td {
		padding: 0 10px 0 0;
		white-space: pre;
		vertical-align: top;
	}
	.a {
		color: var(--ec-offset);
		padding-left: 10px !important;
		opacity: 0.8;
	}
	.why {
		color: var(--fg-faint);
		font-size: 10.5px;
		padding-right: 10px !important;
	}
	.m {
		color: var(--ec-mov);
	}
	.m.call {
		color: var(--ec-call);
		font-weight: 600;
	}
	.m.ucall {
		color: var(--ec-ucall);
		font-weight: 600;
	}
	.m.jmp {
		color: var(--ec-jmp);
	}
	.m.cjmp {
		color: var(--ec-cjmp);
	}
	.m.ujmp {
		color: var(--ec-ujmp);
	}
	.m.ret {
		color: var(--ec-ret);
	}
	.m.trap {
		color: var(--ec-trap);
		font-weight: 600;
	}
	.m.swi {
		color: var(--ec-swi);
	}
	.m.math {
		color: var(--ec-math);
	}
	.m.bin {
		color: var(--ec-bin);
	}
	.m.cmp {
		color: var(--ec-cmp);
	}
	.m.push {
		color: var(--ec-push);
	}
	.m.pop {
		color: var(--ec-pop);
	}
	.m.nop {
		color: var(--ec-nop);
	}
	.o {
		color: var(--ec-mov);
	}
	.o :global(.reg) {
		color: var(--ec-reg);
	}
	.o :global(.num) {
		color: var(--ec-num);
	}
	.o :global(.flag) {
		color: var(--ec-flag);
	}
	.o :global(.sym) {
		color: var(--ec-fname);
	}
	.o :global(.str) {
		color: var(--ec-num);
	}
	.o :global(.size),
	.o :global(.punct) {
		color: var(--ec-other);
	}
	.o :global(.plain) {
		color: var(--ec-mov);
	}
</style>
