<script lang="ts">
	// Install/enable panel for the landing page. guttex ships no plugins and
	// enables nothing by default -- everything here is the user's own choice.
	import { plugins } from '$lib/plugins/host.svelte';

	let url = $state('');
	let open = $state(false);

	const samples = [
		{ url: '/examples/hello-plugin.js', label: 'hello -- 30 lines, shows the shape of a plugin' },
		{ url: '/examples/ai-explain.js', label: 'ai explain -- bring your own key and endpoint' }
	];

	$effect(() => plugins.init());

	async function install(u: string) {
		await plugins.add(u);
		url = '';
	}
</script>

<section class="panel plugins">
	<div class="panel-head">
		plugins
		<span class="spacer"></span>
		{#if plugins.list.length}
			<span class="dim count">{plugins.list.filter((p) => p.enabled).length} enabled</span>
		{/if}
		<a class="flat-link" href="/plugins">how plugins work</a>
	</div>

	<div class="panel-body">
		{#if plugins.list.length === 0}
			<p class="empty">
				nothing installed. guttex is a remote Ghidra and stops there -- AI, exporters and
				anything else are plugins you add yourself.
			</p>
		{:else}
			<ul class="items">
				{#each plugins.list as p (p.url)}
					<li class="item" class:off={!p.enabled}>
						<input
							type="checkbox"
							checked={p.enabled}
							title={p.enabled ? 'disable' : 'enable'}
							onchange={(e) => plugins.setEnabled(p.url, e.currentTarget.checked)}
						/>
						<div class="what">
							<div class="line1">
								<span class="name">{p.manifest?.name ?? p.url.split('/').pop()}</span>
								{#if p.manifest?.version}<span class="dim ver">{p.manifest.version}</span>{/if}
								<span class="badge {p.status}">{p.status}</span>
								{#if p.panels.length}<span class="dim tag">{p.panels.length} panel(s)</span>{/if}
								{#if p.actions.length}<span class="dim tag">{p.actions.length} action(s)</span>{/if}
							</div>
							{#if p.manifest?.description}
								<div class="dim desc">{p.manifest.description}</div>
							{/if}
							<div class="dim src mono" title={p.url}>{p.url}</div>
							{#if p.error}<div class="err desc">{p.error}</div>{/if}
						</div>
						<button class="flat" title="re-fetch the module" onclick={() => plugins.reload(p.url)}>
							reload
						</button>
						<button class="flat" title="uninstall" onclick={() => plugins.remove(p.url)}>x</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="add">
			<input
				class="mono"
				placeholder="https://example.com/my-plugin.js"
				bind:value={url}
				onkeydown={(e) => e.key === 'Enter' && install(url)}
			/>
			<button class="primary" disabled={!url.trim()} onclick={() => install(url)}>install</button>
			<button class="flat" onclick={() => (open = !open)}>{open ? 'hide' : 'examples'}</button>
		</div>

		<p class="warn-note">
			A plugin is JavaScript running inside guttex with the same access this page has: your open
			binaries, every analysis result, and the proxy that already carries your ghidra-rest token.
			Install only code you trust or have read.
		</p>

		{#if open}
			<ul class="samples">
				{#each samples as s (s.url)}
					<li>
						<button class="flat" onclick={() => install(s.url)}>install</button>
						<span class="mono src">{s.url}</span>
						<span class="dim">{s.label}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.plugins {
		width: 100%;
		max-width: 860px;
	}
	.count {
		font-size: 11px;
	}
	.flat-link {
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 7px 10px;
		border-bottom: 1px solid var(--border-soft);
	}
	.item.off .what {
		opacity: 0.55;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
	}
	.line1 {
		display: flex;
		align-items: center;
		gap: 7px;
		flex-wrap: wrap;
	}
	.name {
		font-weight: 600;
	}
	.ver,
	.tag,
	.desc,
	.src {
		font-size: 11px;
	}
	.src {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge.active {
		color: var(--ok);
		border-color: var(--ok);
	}
	.badge.error {
		color: var(--err);
		border-color: var(--err);
	}
	.add {
		display: flex;
		gap: 8px;
		padding: 10px;
	}
	.add input {
		flex: 1 1 auto;
		min-width: 0;
	}
	.warn-note {
		margin: 0;
		padding: 0 10px 10px;
		font-size: 11px;
		color: var(--warn);
		line-height: 1.5;
	}
	.samples {
		list-style: none;
		margin: 0;
		padding: 0 10px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 11px;
	}
	.samples li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
