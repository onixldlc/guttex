<script lang="ts">
	// Right dock: everything that hangs off the selected address -- signature,
	// parameters, call graph edges, and the xref index both ways.
	import { api } from '$lib/api/client';
	import type { XrefsResponse } from '$lib/api/types';
	import { session } from '$lib/state/session.svelte';
	import { displayAddr } from '$lib/format';

	let xrefs = $state<XrefsResponse | null>(null);
	let error = $state('');

	$effect(() => {
		const id = session.id;
		const addr = session.addr;
		if (!id || !addr) {
			xrefs = null;
			return;
		}
		let stale = false;
		error = '';
		api
			.xrefs(id, addr)
			.then((x) => {
				if (!stale) xrefs = x;
			})
			.catch((e) => {
				if (stale) return;
				xrefs = null;
				error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});

	let fn = $derived(session.fn);
</script>

<div class="panel">
	<div class="panel-head">details</div>
	<div class="panel-body pad">
		{#if !session.addr}
			<p class="empty">nothing selected</p>
		{:else}
			<div class="head">
				<span class="addr">{displayAddr(session.addr)}</span>
				{#if fn}<span class="name">{fn.name}</span>{/if}
			</div>

			{#if fn}
				{#if fn.signature}
					<pre class="sig">{fn.signature}</pre>
				{/if}
				<div class="flags">
					{#if fn.calling_convention}<span class="badge">{fn.calling_convention}</span>{/if}
					{#if fn.size}<span class="badge">{fn.size} B</span>{/if}
					{#if fn.is_thunk}<span class="badge">thunk</span>{/if}
					{#if fn.is_external}<span class="badge">external</span>{/if}
					{#if fn.no_return}<span class="badge">noreturn</span>{/if}
					{#if fn.has_varargs}<span class="badge">varargs</span>{/if}
				</div>

				{#if fn.parameters?.length}
					<h4>parameters</h4>
					<ul class="plain mono">
						{#each fn.parameters as p (p.ordinal)}
							<li><span class="ptype">{p.type}</span> {p.name}</li>
						{/each}
					</ul>
				{/if}

				{#if fn.calls?.length}
					<h4>calls ({fn.calls.length})</h4>
					<ul class="links">
						{#each fn.calls as c (c.address + c.name)}
							<li>
								<button class="flat" onclick={() => session.select(c.address, 'decompiler')}>
									<span class="addr">{displayAddr(c.address)}</span>{c.name}
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if fn.called_by?.length}
					<h4>called by ({fn.called_by.length})</h4>
					<ul class="links">
						{#each fn.called_by as c (c.address + c.name)}
							<li>
								<button class="flat" onclick={() => session.select(c.address, 'decompiler')}>
									<span class="addr">{displayAddr(c.address)}</span>{c.name}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if session.fnError}
				<p class="dim small">not a function address</p>
			{/if}

			{#if error}
				<p class="err small">{error}</p>
			{:else if xrefs}
				<h4>xrefs to ({xrefs.to?.length ?? 0})</h4>
				<ul class="links">
					{#each xrefs.to ?? [] as x (x.address + (x.type ?? ''))}
						<li>
							<button class="flat" onclick={() => session.select(x.address, 'hex')}>
								<span class="addr">{displayAddr(x.address)}</span>
								<span class="kind">{x.is_call ? 'call' : x.is_jump ? 'jump' : (x.type ?? 'ref')}</span>
							</button>
						</li>
					{:else}
						<li class="dim small">none</li>
					{/each}
				</ul>

				<h4>xrefs from ({xrefs.from?.length ?? 0})</h4>
				<ul class="links">
					{#each xrefs.from ?? [] as x (x.address + (x.type ?? ''))}
						<li>
							<button class="flat" onclick={() => session.select(x.address, 'hex')}>
								<span class="addr">{displayAddr(x.address)}</span>
								<span class="kind">{x.is_call ? 'call' : x.is_jump ? 'jump' : (x.type ?? 'ref')}</span>
							</button>
						</li>
					{:else}
						<li class="dim small">none</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

<style>
	.pad {
		padding: 8px 10px 24px;
	}
	.head {
		display: flex;
		gap: 8px;
		align-items: baseline;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border-soft);
	}
	.name {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--syn-fn);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	h4 {
		margin: 14px 0 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-dim);
		font-weight: 500;
	}
	pre.sig {
		margin: 8px 0 6px;
		padding: 6px 8px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: 3px;
		font-family: var(--mono);
		font-size: 11.5px;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--fg);
	}
	.flags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	ul.plain li {
		padding: 1px 0;
		font-size: 12px;
	}
	.ptype {
		color: var(--syn-type);
	}
	ul.links li button {
		display: flex;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 1px 4px;
		font-family: var(--mono);
		font-size: 11.5px;
		border-radius: 2px;
	}
	.kind {
		color: var(--fg-dim);
	}
	.small {
		font-size: 11.5px;
	}
</style>
