<script lang="ts">
	// Center view: raw bytes around the selected address.
	//
	// The dump is rendered here rather than showing ghidra-rest's preformatted
	// text, because patches happen here: a patched byte must show its current
	// value, marked, without the underlying file changing. The bytes come from
	// the response's base64; the patch document says which of them to draw
	// differently. Same rule as renames -- stored artifacts are never
	// rewritten, views resolve at render time.
	import { api, ApiError } from '$lib/api/client';
	import type { HexdumpResponse } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { renames, normAob } from '$lib/state/renames.svelte';
	import { displayAddr, normAddr } from '$lib/format';

	let length = $state(256);
	let cursor = $state('');
	let data = $state<HexdumpResponse | null>(null);
	let loading = $state(false);
	let error = $state('');

	// the patch form; `patchAddr` follows the cursor until typed in
	let patchAddr = $state('');
	let patchAob = $state('');
	let patchErr = $state('');
	let listOpen = $state(false);

	// follow the dock selection, but keep our own cursor while paging
	$effect(() => {
		const a = session.addr;
		if (a) cursor = a;
	});

	$effect(() => {
		const id = session.id;
		const at = cursor || normAddr(session.summary?.image_base ?? '');
		const len = length;
		if (!id || !at) return;
		let stale = false;
		loading = true;
		error = '';
		api
			.hexdump(id, at, len)
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

	function step(delta: number) {
		const base = parseInt(normAddr(cursor || '0'), 16);
		if (Number.isNaN(base)) return;
		cursor = Math.max(0, base + delta).toString(16);
	}

	// ------------------------------------------------------------- the dump

	type Cell = { hex: string; patched: boolean };
	type Row = { addr: string; cells: (Cell | null)[]; ascii: string };

	const bytes = $derived.by(() => {
		if (!data?.base64) return null;
		try {
			const bin = atob(data.base64);
			const out = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
			return out;
		} catch {
			return null;
		}
	});

	/** start of the visible window, or null for spaced addresses (`external:1`) */
	const baseAddr = $derived.by(() => {
		const a = normAddr(data?.address ?? '');
		if (!a || a.includes(':')) return null;
		try {
			return BigInt('0x' + a);
		} catch {
			return null;
		}
	});

	const patchList = $derived(session.project ? renames.patchList(session.project) : []);

	/** absolute address -> patched byte value, for the visible window only */
	const overlay = $derived.by(() => {
		const m = new Map<bigint, number>();
		if (baseAddr === null || !bytes) return m;
		const lo = baseAddr;
		const hi = baseAddr + BigInt(bytes.length);
		for (const p of patchList) {
			if (p.addr.includes(':')) continue;
			const at = BigInt('0x' + p.addr);
			const vals = p.changes.split(' ').map((h) => parseInt(h, 16));
			for (let i = 0; i < vals.length; i++) {
				const a = at + BigInt(i);
				if (a >= lo && a < hi) m.set(a, vals[i]);
			}
		}
		return m;
	});

	const rows = $derived.by(() => {
		if (!bytes || baseAddr === null) return [];
		const out: Row[] = [];
		for (let i = 0; i < bytes.length; i += 16) {
			const cells: (Cell | null)[] = [];
			let ascii = '';
			for (let j = 0; j < 16; j++) {
				if (i + j >= bytes.length) {
					cells.push(null);
					continue;
				}
				const a = baseAddr + BigInt(i + j);
				const patched = overlay.has(a);
				const v = patched ? overlay.get(a)! : bytes[i + j];
				cells.push({ hex: v.toString(16).padStart(2, '0'), patched });
				ascii += v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.';
			}
			out.push({ addr: (baseAddr + BigInt(i)).toString(16).padStart(8, '0'), cells, ascii });
		}
		return out;
	});

	// -------------------------------------------------------------- patching

	function apply(e: SubmitEvent) {
		e.preventDefault();
		patchErr = '';
		const addr = normAddr(patchAddr || cursor);
		if (!addr || addr.includes(':')) {
			patchErr = 'need a plain address';
			return;
		}
		const aob = normAob(patchAob);
		if (!aob) {
			patchErr = 'bytes must be whole hex pairs, e.g. "a0 b0"';
			return;
		}
		if (!session.project) {
			patchErr = 'no project yet (job still loading?)';
			return;
		}
		renames.setPatch(session.project, addr, aob);
		patchAob = '';
	}

	function drop(addr: string) {
		if (session.project) renames.delPatch(session.project, addr);
	}
</script>

<div class="wrap">
	<div class="sub">
		<button class="flat" onclick={() => step(-length)} disabled={!cursor}>&lt;&lt;</button>
		<span class="addr">{displayAddr(data?.address ?? cursor)}</span>
		<button class="flat" onclick={() => step(length)} disabled={!cursor}>&gt;&gt;</button>
		<select bind:value={length}>
			{#each [128, 256, 512, 1024, 4096] as n (n)}
				<option value={n}>{n} B</option>
			{/each}
		</select>
		{#if data?.block}<span class="badge">{data.block}</span>{/if}
		{#if data}<span class="dim mono">{data.length} B</span>{/if}
		<button class="flat" class:on={listOpen} onclick={() => (listOpen = !listOpen)}>
			patches{patchList.length ? ` (${patchList.length})` : ''}
		</button>
		<span class="spacer"></span>
		{#if loading}<span class="dim">loading...</span>{/if}
	</div>

	<form class="sub patch" onsubmit={apply}>
		<span class="dim">patch</span>
		<input
			class="mono"
			size="10"
			bind:value={patchAddr}
			placeholder={displayAddr(cursor) || 'address'}
			aria-label="patch address"
		/>
		<input
			class="mono grow"
			bind:value={patchAob}
			placeholder="bytes, e.g. 90 90 or eb0c"
			aria-label="patch bytes"
		/>
		<button class="flat" disabled={!patchAob.trim()}>apply</button>
		{#if patchErr}<span class="err small">{patchErr}</span>{/if}
	</form>

	{#if listOpen}
		<div class="plist">
			{#if !patchList.length}
				<p class="empty">no patches yet -- the binary is untouched either way; patches are applied to a copy on export</p>
			{:else}
				{#each patchList as p (p.addr)}
					<div class="prow mono">
						<button class="flat addrbtn" onclick={() => (cursor = p.addr)}>
							{displayAddr(p.addr)}
						</button>
						<span class="now">{p.changes}</span>
						<span class="spacer"></span>
						<button class="flat del" title="withdraw this patch" onclick={() => drop(p.addr)}>x</button>
					</div>
				{/each}
			{/if}
		</div>
	{/if}

	<div class="panel-body code">
		{#if error}
			<p class="empty err">{error}</p>
		{:else if rows.length}
			<pre>{#each rows as r (r.addr)}<span class="a">{r.addr}</span>  {#each r.cells as c, j (j)}{#if c}<span class:hot={c.patched}>{c.hex}</span>{:else}{'  '}{/if}{j === 7 ? '  ' : ' '}{/each} |{r.ascii}|
{/each}</pre>
		{:else if data?.hex}
			<!-- spaced address space (no linear base): fall back to the server's text -->
			<pre>{data.hex}</pre>
		{:else if !cursor}
			<p class="empty">pick an address</p>
		{:else if !loading}
			<p class="empty">no bytes at this address (uninitialised block?)</p>
		{/if}
	</div>
</div>

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
		gap: 8px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.patch input.grow {
		flex: 1 1 120px;
		min-width: 60px;
	}
	.small {
		font-size: 11px;
	}
	.plist {
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
		max-height: 30%;
		overflow-y: auto;
		padding: 2px 0;
	}
	.plist .empty {
		margin: 4px 10px;
		font-size: 11px;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 1px 8px;
		font-size: 12px;
	}
	.addrbtn {
		padding: 1px 4px;
	}
	.now {
		color: var(--accent);
	}
	.del {
		padding: 0 6px;
	}
	button.on {
		background: var(--bg-elev);
		border-color: var(--accent-dim);
		color: var(--accent);
	}
	.code {
		background: var(--bg);
	}
	pre {
		margin: 0;
		padding: 8px 10px 30px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--fg);
	}
	.a {
		color: var(--fg-faint);
	}
	.hot {
		color: var(--accent);
		font-weight: 600;
		text-decoration: underline dotted;
	}
</style>
