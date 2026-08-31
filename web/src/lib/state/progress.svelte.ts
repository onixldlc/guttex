// What analyzeHeadless is actually doing, while it does it.
//
// ghidra-rest reports a job as `queued`/`running`/`done` and nothing else, so a
// ten-minute analysis looked exactly like a hung one. The detail was never
// missing -- it is in the headless log, which already has an endpoint
// (`GET /v1/jobs/{id}/log?tail=`) and is already proxied. So this adds no
// service, no route and no polling loop: it folds the log into phases and
// counters on the tick `session.watch()` already runs.
//
// Parsing a log is a contract with a text format, so every marker is optional.
// A line that is not there (an older ghidra-rest image, a script that does not
// print totals) costs one detail, never the readout. Everything learned is
// sticky per job because the tail is a window -- markers scroll out of it.

import { api } from '$lib/api/client';
import type { Job } from '$lib/api/types';

export type Stage =
	| 'queued'
	| 'starting'
	| 'importing'
	| 'analysing'
	| 'exporting'
	| 'decompiling'
	| 'done';

/** The order the phases happen in. Progress only ever moves forwards. */
const ORDER: Stage[] = [
	'queued',
	'starting',
	'importing',
	'analysing',
	'exporting',
	'decompiling',
	'done'
];

export function rankOf(s: Stage): number {
	const i = ORDER.indexOf(s);
	return i < 0 ? 0 : i;
}

/** The checklist the loading screen draws, in order. */
export const STAGES: { key: Stage; label: string }[] = [
	{ key: 'starting', label: 'starting ghidra' },
	{ key: 'importing', label: 'loading the binary' },
	{ key: 'analysing', label: 'auto-analysis' },
	{ key: 'exporting', label: 'exporting artifacts' },
	{ key: 'decompiling', label: 'decompiling functions' }
];

export type JobProgress = {
	stage: Stage;
	/** the exporter currently running: `functions`, `disasm`, ... */
	step: string;
	/** what was imported, and what ghidra decided it is */
	file: string;
	loader: string;
	language: string;
	/** functions written to functions.json so far */
	funcs: number;
	/** exact function count, once the export says so; 0 while unknown */
	funcTotal: number;
	/** decompiler: succeeded, attempted, and how many there are to attempt */
	decOk: number;
	decSeen: number;
	decTotal: number;
	/** the decompile cap was hit -- the rest are deliberately not decompiled */
	capped: boolean;
	/** last thing ghidra said, prefix and logger name stripped */
	last: string;
	/**
	 * How loudly it said it. An analyser that gives up logs ERROR and the run
	 * carries on regardless -- `GolangSymbolAnalyzer` on a Go version Ghidra
	 * has not been taught, say -- so this colours the line without ever being
	 * read as "the job died". Only `job.status` says that.
	 */
	lastLevel: '' | 'INFO' | 'WARN' | 'ERROR';
	/** how far the analysers got, once the run prints its timing table */
	analysisSecs: number;
	/** log size, and when it last changed: the only liveness signal a client gets */
	bytes: number;
	movedAt: number;
};

function blank(): JobProgress {
	return {
		stage: 'queued',
		step: '',
		file: '',
		loader: '',
		language: '',
		funcs: 0,
		funcTotal: 0,
		decOk: 0,
		decSeen: 0,
		decTotal: 0,
		capped: false,
		last: '',
		lastLevel: '',
		analysisSecs: 0,
		bytes: 0,
		movedAt: 0
	};
}

// Log lines worth reading. Everything else is noise the console can show.
//
// The `ExportJSON:` markers come from `scripts/ExportJSON.java` in ghidra-rest;
// `stage`, `functions total=` and `decompiling 0/N` are newer than the rest, so
// their absence is handled rather than assumed.
const RE = {
	start: /HEADLESS: execution starts/,
	importing: /IMPORTING:\s+(\S+)/,
	loader: /Using Loader:\s+(.+?)\s*$/,
	language: /Using Language\/Compiler:\s+(\S+)/,
	analysing: /ANALYZING all memory and code/,
	analysisTime: /^\s*Total Time\s+(\d+)\s+secs/,
	script: /REPORT: Execute script:/,
	stage: /ExportJSON: stage ([a-z]+)/,
	funcs: /ExportJSON: functions (\d+)\b/,
	funcTotal: /ExportJSON: functions total=(\d+)/,
	decTotal: /ExportJSON: decompiling \d+\/(\d+)/,
	dec: /ExportJSON: decompiled (\d+)\/(\d+)/,
	cap: /ExportJSON: decompile cap \d+ reached/,
	done: /ExportJSON: done functions=(\d+) decompiled=(\d+)/
} as const;

/** `INFO  ExportJSON.java> ExportJSON: functions 500 (GhidraScript)` -> the middle bit */
function clean(line: string): string {
	return line
		.replace(/^(INFO|WARN|ERROR|DEBUG)\s+/, '')
		.replace(/\s*\([A-Za-z0-9_$.]+\)\s*$/, '')
		.replace(/^[A-Za-z0-9_]+\.java>\s*/, '')
		.trim();
}

function basename(p: string): string {
	return p.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? p;
}

/**
 * Fold a chunk of log into what is already known.
 *
 * `prev` matters: the caller passes a tail, and on a long job the import and
 * analysis markers are long gone from it by the time the decompiler is running.
 * Nothing here ever clears a field, and the stage only moves forwards.
 */
export function parse(text: string, prev?: JobProgress): JobProgress {
	const p: JobProgress = { ...(prev ?? blank()) };
	const at = (s: Stage) => {
		if (rankOf(s) > rankOf(p.stage)) p.stage = s;
	};

	for (const raw of text.split('\n')) {
		const line = clean(raw);
		if (!line) continue;
		p.last = line;
		const lvl = raw.match(/^(INFO|WARN|ERROR)\b/);
		p.lastLevel = (lvl?.[1] ?? '') as JobProgress['lastLevel'];

		let m: RegExpMatchArray | null;
		if (RE.start.test(line)) at('starting');
		if ((m = line.match(RE.importing))) {
			at('importing');
			p.file = basename(m[1]);
		}
		if ((m = line.match(RE.loader))) p.loader = m[1];
		if ((m = line.match(RE.language))) p.language = m[1];
		if (RE.analysing.test(line)) at('analysing');
		if ((m = line.match(RE.analysisTime))) p.analysisSecs = Number(m[1]);
		if (RE.script.test(line)) at('exporting');

		if ((m = line.match(RE.stage))) {
			at('exporting');
			p.step = m[1];
		}
		if ((m = line.match(RE.funcTotal))) {
			p.funcTotal = Number(m[1]);
			p.funcs = Math.max(p.funcs, p.funcTotal);
		} else if ((m = line.match(RE.funcs))) {
			at('exporting');
			p.step ||= 'functions';
			p.funcs = Math.max(p.funcs, Number(m[1]));
		}
		if ((m = line.match(RE.decTotal))) {
			at('decompiling');
			p.decTotal = Number(m[1]);
		}
		if ((m = line.match(RE.dec))) {
			at('decompiling');
			p.decOk = Number(m[1]);
			p.decSeen = Number(m[2]);
		}
		if (RE.cap.test(line)) p.capped = true;
		if ((m = line.match(RE.done))) {
			at('done');
			p.funcTotal = Number(m[1]);
			p.decOk = Number(m[2]);
		}
	}

	return p;
}

/**
 * How many functions the decompiler is going to walk.
 *
 * Only `decompiling 0/N` states it. Failing that the functions phase gives a
 * floor -- it prints in 500s -- and that is still worth showing, marked. A
 * candidate no bigger than the number already done is not a denominator at
 * all: 0 says "unknown" and the UI stops drawing a bar rather than drawing a
 * finished one.
 */
export function decDenom(p: JobProgress): number {
	const n = p.decTotal || p.funcTotal || p.funcs;
	return n > p.decSeen ? n : 0;
}

/** true when the denominator is a floor rather than the decompiler's own count */
export function approx(p: JobProgress): boolean {
	return !p.decTotal;
}

/** 0..1 within the current phase, or -1 when there is nothing honest to show */
export function fraction(p: JobProgress): number {
	const n = decDenom(p);
	if (p.stage === 'decompiling' && n) return Math.min(1, p.decSeen / n);
	return -1;
}

/** one line, for the title bar and the job list */
export function progressLine(p: JobProgress): string {
	switch (p.stage) {
		case 'queued':
			return 'queued';
		case 'starting':
			return 'starting ghidra';
		case 'importing':
			return p.file ? `loading ${p.file}` : 'loading the binary';
		case 'analysing':
			return 'auto-analysis';
		case 'exporting':
			return p.funcs
				? `exporting ${p.step || 'artifacts'} - ${p.funcs.toLocaleString()} functions`
				: `exporting ${p.step || 'artifacts'}`;
		case 'decompiling': {
			const d = decDenom(p);
			const n = d ? `${approx(p) ? '~' : ''}${d.toLocaleString()}` : '?';
			return `decompiling ${p.decSeen.toLocaleString()}/${n}`;
		}
		case 'done':
			return 'writing results';
	}
}

/**
 * What killed a run, in words, with something to do about it.
 *
 * ghidra-rest builds `job.error` in `runJob`/`runHeadless`, and there are only
 * five shapes it can take. Each one has a different answer, and "failed" on its
 * own has none -- which is what sends people to the log to guess.
 *
 * The log tail rides along in `error` after the first line; it is the evidence,
 * so it is kept rather than thrown away.
 */
export type Diagnosis = { what: string; why: string; next: string; tail: string };

/**
 * The java line that actually says what went wrong.
 *
 * `job.error` leads with `analyzeHeadless failed: exit status 1`, which is
 * true and useless -- the cause is a stack trace 20 lines down the tail. Pull
 * it up front rather than making people scroll a 2KB box to find it.
 */
function cause(tail: string): string {
	const hits = [
		...tail.matchAll(
			/^(?:Exception in thread "[^"]*" )?([\w.$]*(?:Exception|Error))(?::\s*(.*?))?\s*$/gm
		)
	];
	const last = hits[hits.length - 1];
	if (!last) return '';
	const cls = last[1].split('.').pop() || last[1];
	return last[2] ? `${cls}: ${last[2]}` : cls;
}

export function diagnose(job: Job | null | undefined): Diagnosis | null {
	if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return null;
	const raw = job.error ?? '';
	const [head = '', ...rest] = raw.split('\n');
	const tail = rest.join('\n').trim();

	if (job.status === 'canceled') {
		return {
			what: 'you stopped this run',
			why: 'ghidra was killed part way through, so no artifacts were written.',
			next: 'upload the binary again to start over.',
			tail
		};
	}
	if (/interrupted by a server restart/i.test(raw)) {
		return {
			what: 'the server restarted under it',
			why: 'ghidra-rest marks anything still running when it boots as failed -- the JVM went down with the old container, so there is nothing to resume.',
			next: 'upload the binary again. Recreating the stack while a job runs will do this every time.',
			tail
		};
	}
	if (/timed out after/i.test(raw)) {
		return {
			what: 'ghidra ran out of time',
			why: `${head} -- auto-analysis was still working when the clock ran out.`,
			next: 'raise the analysis timeout, or turn decompilation off, and upload it again.',
			tail
		};
	}
	if (/signal: killed|exit status 137|OutOfMemoryError|GC overhead/i.test(raw)) {
		return {
			what: 'the JVM was killed',
			why: 'that is what running out of memory looks like from out here -- either the container hit its limit or the host reclaimed it.',
			next: 'give ghidra-rest more memory (JAVA_MAX_MEM), or analyse a smaller binary.',
			tail
		};
	}
	const why = cause(tail);
	if (/no summary\.json/i.test(raw)) {
		return {
			what: 'the export never finished',
			why:
				why ||
				'analyzeHeadless exited before ExportJSON wrote summary.json, so the artifact set is incomplete and the server will not serve half of one.',
			next: 'ExportJSON stopped part way; the artifact set is incomplete, so the server serves none of it.',
			tail
		};
	}
	return {
		what: 'analyzeHeadless exited with an error',
		why: why || head || 'the analyser stopped and did not say why.',
		next: `${head || 'the launcher exited non-zero'} -- the full log is below; upload the binary again to retry.`,
		tail
	};
}

class Progress {
	/** by job id: several can be running, and the landing page lists them all */
	jobs = $state<Record<string, JobProgress>>({});

	/** a slow log read must not stack up behind the 2s poll */
	#busy = new Set<string>();

	get(id: string): JobProgress {
		return this.jobs[id] ?? blank();
	}

	line(id: string): string {
		return progressLine(this.get(id));
	}

	/**
	 * Read the log and fold it in.
	 *
	 * The whole log is asked for rather than a small tail: it is ~20KB even for
	 * a 38k-function binary, and a tail that clips the import markers turns
	 * into a readout that forgets what it is analysing.
	 */
	async pull(id: string) {
		if (!id || this.#busy.has(id)) return;
		this.#busy.add(id);
		try {
			const text = await api.jobLog(id, 65536);
			const prev = this.jobs[id];
			const next = parse(text, prev);
			// Auto-analysis can run for twenty minutes without printing a word,
			// which is the exact shape of a hang. Say how long it has been
			// quiet rather than leaving people to guess.
			next.bytes = text.length;
			next.movedAt = prev && prev.bytes === next.bytes ? prev.movedAt : Date.now();
			this.jobs = { ...this.jobs, [id]: next };
		} catch {
			// 404 until the worker creates the log -- the job is still queued
		} finally {
			this.#busy.delete(id);
		}
	}

	drop(id: string) {
		if (!(id in this.jobs)) return;
		const { [id]: _gone, ...rest } = this.jobs;
		this.jobs = rest;
	}
}

export const progress = new Progress();
