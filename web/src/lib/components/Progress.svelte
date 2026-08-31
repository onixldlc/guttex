<script lang="ts">
	// The loading screen, as a window over the workbench.
	//
	// It covers the docks and the centre views -- which have nothing to draw
	// until the run finishes -- and nothing else. The title bar and the console
	// dock sit outside it on purpose: the console is where the raw headless log
	// is, and blurring the thing you watch progress in would be daft.
	//
	// The point is that a long run looks like work rather than like a hang, so
	// it says which phase, how far into it, and the last thing ghidra actually
	// printed. Where a number is a floor rather than a total it is marked `~` --
	// a fake denominator is worse than an honest one.
	import { goto } from '$app/navigation';
	import { session } from '$lib/state/session.svelte';
	import {
		STAGES,
		approx,
		decDenom,
		diagnose,
		fraction,
		progress,
		rankOf,
		type Stage
	} from '$lib/state/progress.svelte';

	let p = $derived(progress.get(session.id));
	let rank = $derived(rankOf(p.stage));
	let frac = $derived(fraction(p));
	let failed = $derived(session.job?.status === 'failed' || session.job?.status === 'canceled');
	// The same window, in red: where it got to, what stopped it, what to do.
	let dead = $derived(diagnose(session.job));

	// Elapsed has to tick on its own: nothing else changes between polls, and a
	// frozen clock is exactly the "is it stuck?" question this view exists to
	// answer.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	// How long since the log grew. Ghidra's auto-analysis is silent for whole
	// minutes at a time, so this is a fact to report, not a verdict: a quiet
	// job is usually a busy one. The only thing that means "dead" is the job
	// status going terminal.
	let quiet = $derived(p.movedAt ? Math.round((now - p.movedAt) / 1000) : 0);
	let quietFor = $derived.by(() => {
		if (failed || quiet < 120) return '';
		const m = Math.floor(quiet / 60);
		return `no new output for ${m}m -- auto-analysis prints nothing until an analyser finishes`;
	});

	let elapsed = $derived.by(() => {
		const from = session.job?.started_at ?? session.job?.created_at;
		if (!from) return '';
		// A finished job's clock stops where it stopped.
		const to = session.job?.finished_at ? Date.parse(session.job.finished_at) : now;
		const s = Math.max(0, Math.round((to - Date.parse(from)) / 1000));
		const m = Math.floor(s / 60);
		return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
	});

	// Open the log tail at the bottom, where the stack trace is.
	let tailEl = $state<HTMLPreElement | undefined>();
	$effect(() => {
		if (dead?.tail && tailEl) tailEl.scrollTop = tailEl.scrollHeight;
	});

	function stepState(key: Stage): 'done' | 'now' | 'todo' | 'died' {
		const r = rankOf(key);
		if (r < rank) return 'done';
		if (r > rank) return 'todo';
		return failed ? 'died' : 'now';
	}

	/** the counter that belongs to a phase, or '' when it has none to give */
	function detail(key: Stage): string {
		if (key === 'importing') {
			return [p.loader, p.language].filter(Boolean).join(' - ');
		}
		if (key === 'analysing') {
			return p.analysisSecs ? `${p.analysisSecs}s of analysers` : '';
		}
		if (key === 'exporting') {
			const bits = [];
			if (p.step) bits.push(p.step);
			if (p.funcs) bits.push(`${p.funcs.toLocaleString()} functions`);
			return bits.join(' - ');
		}
		if (key === 'decompiling' && p.decSeen) {
			const d = decDenom(p);
			const n = d ? `${approx(p) ? '~' : ''}${d.toLocaleString()}` : '?';
			return `${p.decSeen.toLocaleString()} / ${n}${p.capped ? ' (cap reached)' : ''}`;
		}
		return '';
	}
</script>

<div class="veil">
	<div
		class="box"
		class:bad={failed}
		role="status"
		aria-live="polite"
		aria-label="analysis progress"
	>
		<div class="head">
			<span class="what">{failed ? 'analysis failed' : 'analysis'}</span>
			<span class="spacer"></span>
			<span class="badge {session.job?.status}">{session.job?.status ?? '...'}</span>
			{#if elapsed}<span class="dim mono">{elapsed}</span>{/if}
		</div>

		<div class="body">
			<p class="file mono" title={session.job?.filename}>
				{session.job?.filename || session.id}
			</p>

			<ol class="steps">
				{#each STAGES as s (s.key)}
					{@const st = stepState(s.key)}
					{@const d = detail(s.key)}
					<li class={st}>
						<span class="tick" aria-hidden="true"
							>{st === 'done' ? '+' : st === 'died' ? 'x' : st === 'now' ? '>' : '.'}</span
						>
						<span class="label">{s.label}</span>
						{#if d}<span class="detail mono">{d}</span>{/if}
					</li>
				{/each}
			</ol>

			<!-- Indeterminate unless the decompiler is running: that is the only
			     phase whose end is known while it is happening. -->
			<div class="bar" class:idle={failed}>
				{#if frac >= 0}
					<div class="fill" style:width="{Math.round(frac * 100)}%"></div>
				{:else if !failed}
					<div class="fill sweep"></div>
				{/if}
			</div>

			<p
				class="last mono"
				class:warn={!failed && p.lastLevel === 'WARN'}
				class:bad={!failed && p.lastLevel === 'ERROR'}
				title={p.last}
			>
				{p.last || 'waiting for the worker to pick this up'}
			</p>

			<!-- An analyser that cannot do its job says ERROR and Ghidra moves on
			     to the next one. Without this the loudest line on screen reads
			     like a crash report for a run that is fine. -->
			{#if !failed && (p.lastLevel === 'ERROR' || p.lastLevel === 'WARN')}
				<p class="hint dim">an analyser complained and was skipped -- the run carries on</p>
			{/if}
			{#if quietFor}
				<p class="hint dim">{quietFor}</p>
			{/if}

			<!-- What stopped it, why, and what to do about it. `job.error` on its
			     own is a go-read-the-log, which is the state this replaces. -->
			{#if dead}
				<div class="dead">
					<p class="what">{dead.what}</p>
					<p class="why">{dead.why}</p>
					<p class="next">{dead.next}</p>
					{#if dead.tail}
						<!-- Java puts the cause at the *end*. A box that opens at the
						     top shows the JVM banner. -->
						<pre class="tail mono" bind:this={tailEl}>{dead.tail}</pre>
					{/if}
				</div>
			{/if}
		</div>

		<div class="foot">
			{#if failed}
				<span class="err">nothing was produced -- upload the binary again to redo it</span>
			{:else}
				<span class="dim">artifacts are written at the end, so the views stay empty until then</span>
			{/if}
			<span class="spacer"></span>
			<!-- The console is outside this window, so it keeps working while
			     this is up -- that is the point of not covering it. -->
			<button
				class="flat"
				onclick={() => {
					session.consoleOpen = true;
					session.refreshLog();
				}}>full log</button
			>
			{#if failed}
				<!-- A dead job has nowhere to go on this page. The way out is
				     explicit rather than automatic: the reason it died is on
				     screen, and yanking the page away would take it with it. -->
				<button class="btn" onclick={() => goto('/')}>back to jobs</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.veil {
		position: absolute;
		inset: 0;
		/* above the panels, below the real dialogs (rename sits at 90) */
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: rgb(0 0 0 / 45%);
		backdrop-filter: blur(4px);
	}
	.box {
		width: min(520px, 100%);
		max-height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 5px;
		box-shadow: 0 12px 40px rgb(0 0 0 / 55%);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--head-h);
		flex: 0 0 var(--head-h);
		padding: 0 10px;
		background: var(--bg-head);
		border-bottom: 1px solid var(--border);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-dim);
	}
	.what {
		color: var(--fg);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px;
		min-height: 0;
		overflow: auto;
	}
	.file {
		margin: 0;
		font-size: 12.5px;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.steps li {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 12.5px;
		color: var(--fg-faint);
	}
	.steps li.done {
		color: var(--fg-dim);
	}
	.steps li.now {
		color: var(--fg);
	}
	.steps li.died {
		color: var(--err);
	}
	.died .tick {
		color: var(--err);
	}
	.tick {
		font-family: var(--mono);
		width: 1em;
		text-align: center;
	}
	.done .tick {
		color: var(--ok);
	}
	.now .tick {
		color: var(--accent);
	}
	.detail {
		font-size: 11.5px;
		color: var(--fg-dim);
	}
	.bar {
		height: 4px;
		border-radius: 2px;
		background: var(--bg-input);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.4s linear;
	}
	.sweep {
		width: 34%;
		animation: sweep 1.6s ease-in-out infinite;
	}
	@keyframes sweep {
		0% {
			margin-left: -34%;
		}
		100% {
			margin-left: 100%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sweep {
			animation: none;
			width: 100%;
			opacity: 0.35;
		}
	}
	.last {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.4;
		color: var(--fg-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-top: 1px solid var(--border);
		background: var(--bg-panel);
		font-size: 11px;
	}
	.foot button {
		padding: 2px 7px;
		font-size: 11px;
	}
	.err {
		margin: 0;
		font-size: 12px;
		color: var(--err);
	}
	.hint {
		margin: 0;
		font-size: 11px;
		line-height: 1.4;
	}
	.box.bad {
		border-color: var(--err);
	}
	.box.bad .head {
		color: var(--err);
	}
	.box.bad .head .what {
		color: var(--err);
	}
	.dead {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 10px;
		border: 1px solid var(--err);
		border-radius: 4px;
		background: rgb(224 108 117 / 8%);
	}
	.dead p {
		margin: 0;
		font-size: 12px;
		line-height: 1.45;
	}
	.dead .what {
		color: var(--err);
		font-size: 12.5px;
	}
	.dead .why {
		color: var(--fg);
	}
	.dead .next {
		color: var(--fg-dim);
	}
	.tail {
		margin: 4px 0 0;
		padding: 6px 8px;
		max-height: 150px;
		overflow: auto;
		font-size: 11px;
		line-height: 1.4;
		white-space: pre-wrap;
		color: var(--fg-dim);
		background: var(--bg-input);
		border-radius: 3px;
	}
	.last.warn {
		color: var(--warn);
	}
	.last.bad {
		color: var(--err);
	}
	.foot .btn {
		padding: 2px 8px;
		font-size: 11px;
	}
</style>
