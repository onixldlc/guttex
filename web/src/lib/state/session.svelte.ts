// Workbench state shared by the docks. One binary open at a time, exactly like
// Cutter: the sidebar picks an address, everything else follows it.

import { goto } from '$app/navigation';
import { api, ApiError } from '$lib/api/client';
import type { FunctionEntry, Job, Summary } from '$lib/api/types';
import { normAddr } from '$lib/format';

// `plugin:<pluginId>/<panelId>` tabs come from installed plugins.
export type CenterTab =
	| 'disasm'
	| 'graph'
	| 'decompiler'
	| 'hex'
	| 'callgraph'
	| 'info'
	| `plugin:${string}`;

class Session {
	id = $state('');
	job = $state<Job | null>(null);
	summary = $state<Summary | null>(null);

	/** normalised address currently selected in any dock; mirrors `?a=` */
	addr = $state('');
	fn = $state<FunctionEntry | null>(null);
	fnError = $state('');

	tab = $state<CenterTab>('decompiler');
	consoleOpen = $state(false);
	log = $state('');

	loading = $state(false);
	error = $state('');

	private poll: ReturnType<typeof setInterval> | null = null;

	get ready() {
		return this.job?.status === 'done';
	}

	get title() {
		return this.job?.filename || this.summary?.name || this.id;
	}

	async open(id: string) {
		if (this.id === id && this.job) {
			// Already open. Selecting an address renavigates the route, so this must
			// not refetch -- but the route's cleanup stopped the poller, so an
			// unfinished job needs it back.
			if (this.job.status === 'queued' || this.job.status === 'running') this.watch();
			return;
		}
		if (this.id !== id) this.reset();
		this.id = id;
		this.loading = true;
		this.error = '';
		try {
			this.job = await api.getJob(id);
			if (this.job.status === 'done') await this.loadSummary();
			else this.watch();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	private async loadSummary() {
		try {
			this.summary = await api.summary(this.id);
		} catch (e) {
			// 409 just means the artifact set is still being written.
			if (!(e instanceof ApiError && e.notReady)) {
				this.error = e instanceof Error ? e.message : String(e);
			}
		}
	}

	/** poll a queued/running job until it settles, then pull the summary */
	watch(everyMs = 2000) {
		this.stop();
		this.poll = setInterval(async () => {
			try {
				const j = await api.getJob(this.id);
				this.job = j;
				if (this.consoleOpen) this.refreshLog();
				if (j.status !== 'queued' && j.status !== 'running') {
					this.stop();
					if (j.status === 'done') await this.loadSummary();
				}
			} catch {
				this.stop();
			}
		}, everyMs);
	}

	stop() {
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
	}

	async refreshLog(tail = 400) {
		try {
			this.log = await api.jobLog(this.id, tail);
		} catch (e) {
			this.log = e instanceof Error ? e.message : String(e);
		}
	}

	/**
	 * Every dock navigates through here. Selection lives in the URL (`?a=`), so
	 * the browser's own history *is* the address history -- back/forward, thumb
	 * buttons and Alt+Arrow all traverse visited functions for free. Chromium on
	 * Linux never delivers the thumb buttons to the page, so intercepting the
	 * mouse events could not have worked.
	 */
	async select(addr: string, tab?: CenterTab) {
		const a = normAddr(addr);
		if (!a) return;
		if (tab) this.tab = tab;
		if (a === this.addr) return; // no dupe entries for re-clicking the same row
		await goto(`?a=${encodeURIComponent(a)}`, { keepFocus: true, noScroll: true });
	}

	/** apply what the URL says; called by the route when `?a=` changes */
	async show(addr: string) {
		const a = normAddr(addr);
		this.addr = a;
		this.fn = null;
		this.fnError = '';
		if (!a) return;
		try {
			this.fn = await api.fn(this.id, a);
		} catch (e) {
			// Not every address is a function -- strings and data land here too.
			this.fnError = e instanceof Error ? e.message : String(e);
		}
	}

	reset() {
		this.stop();
		this.job = null;
		this.summary = null;
		this.addr = '';
		this.fn = null;
		this.fnError = '';
		this.log = '';
		this.error = '';
	}
}

export const session = new Session();
