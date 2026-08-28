<script lang="ts">
	// Bottom dock: analyzeHeadless output, tailed straight off /v1/jobs/{id}/log.
	import { session } from '$lib/state/session.svelte';

	let box = $state<HTMLPreElement | null>(null);
	let follow = $state(true);

	$effect(() => {
		void session.log;
		if (follow && box) box.scrollTop = box.scrollHeight;
	});
</script>

<div class="panel console">
	<div class="panel-head">
		console
		<span class="spacer"></span>
		<label class="follow"><input type="checkbox" bind:checked={follow} /> follow</label>
		<button class="flat" onclick={() => session.refreshLog()}>refresh</button>
		<button class="flat" onclick={() => (session.consoleOpen = false)}>close</button>
	</div>
	<pre class="panel-body" bind:this={box}>{session.log || '(no log yet)'}</pre>
</div>

<style>
	.console {
		border-left: none;
		border-right: none;
		border-bottom: none;
	}
	pre {
		margin: 0;
		padding: 6px 10px;
		font-family: var(--mono);
		font-size: 11.5px;
		line-height: 1.4;
		color: var(--fg-dim);
		background: var(--bg);
		white-space: pre-wrap;
	}
	.follow {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
	}
</style>
