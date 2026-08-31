<script lang="ts">
	// The note that says the export is happening. Mounted once per route; it
	// shows itself when `exporter` is working and closes when the file lands in
	// the browser's downloads.
	import { exporter } from '$lib/state/exporter.svelte';
	import { fmtBytes } from '$lib/format';

	// Packing has no byte count to report: the server is building the zip, and
	// on a project whose artifacts were never pulled it is fetching them from
	// ghidra-rest first. That wait is the reason this dialog exists.
	let head = $derived(
		exporter.phase === 'packing'
			? 'exporting...'
			: exporter.phase === 'downloading'
				? 'downloading...'
				: exporter.phase === 'saved'
					? 'saved'
					: 'export failed'
	);
</script>

{#if exporter.open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => exporter.dismiss()}></div>
	<div class="box" role="alertdialog" aria-live="polite" aria-label="export">
		<div class="head">
			{#if exporter.busy}<span class="spin" aria-hidden="true"></span>{/if}
			<b>{head}</b>
			<span class="spacer"></span>
			{#if exporter.phase === 'downloading' && exporter.total}
				<span class="dim mono small">
					{fmtBytes(exporter.got)} / {fmtBytes(exporter.total)}
				</span>
			{:else if exporter.phase === 'downloading'}
				<span class="dim mono small">{fmtBytes(exporter.got)}</span>
			{/if}
		</div>

		{#if exporter.busy}
			<div class="track" class:wait={exporter.pct < 0}>
				<div class="fill" style:width={exporter.pct < 0 ? '' : `${exporter.pct}%`}></div>
			</div>
		{/if}

		{#if exporter.phase === 'error'}
			<p class="err">{exporter.error}</p>
		{:else if exporter.name}
			<p class="dim mono small name">{exporter.name}</p>
		{:else}
			<p class="dim small">names, metadata and the analysis artifacts, in one file</p>
		{/if}

		<div class="foot">
			{#if exporter.busy}
				<span class="dim small">one at a time -- no need to click again</span>
				<span class="spacer"></span>
				<button class="flat" onclick={() => exporter.cancel()}>cancel</button>
			{:else}
				<span class="spacer"></span>
				<button class="flat" onclick={() => exporter.dismiss()}>close</button>
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
		top: 18vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(420px, calc(100vw - 24px));
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 12px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 5px;
		box-shadow: 0 12px 40px rgb(0 0 0 / 55%);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.small {
		font-size: 11px;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.err {
		color: var(--err);
		font-size: 12px;
	}
	p {
		margin: 0;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.foot button {
		padding: 2px 7px;
		font-size: 11px;
	}

	.track {
		height: 4px;
		border-radius: 2px;
		background: var(--bg-panel);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.15s linear;
	}
	/* no content-length yet: the server is still packing, so the bar paces
	   rather than pretending to know how far along it is */
	.track.wait .fill {
		width: 35%;
		animation: sweep 1.1s ease-in-out infinite;
	}
	@keyframes sweep {
		0% {
			margin-left: -35%;
		}
		100% {
			margin-left: 100%;
		}
	}
	.spin {
		width: 12px;
		height: 12px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: turn 0.7s linear infinite;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin,
		.track.wait .fill {
			animation: none;
		}
	}
</style>
