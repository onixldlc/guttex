// What the call graph view is showing: which root, which branches are open.
//
// This lives outside the component on purpose. The call graph is not about one
// function -- it is the map of the whole binary, and you build it up by opening
// branches. Switching to the disassembly tab, walking into a callee, or hitting
// back would unmount the component and throw all of that away, which made the
// view useless for the thing it is for.
//
// Keyed by job, so opening a different binary starts a fresh map. The pan/zoom
// transform is not here: `viewports` already keeps that, keyed the same way.

import {
	autoExpand,
	dropCallGraph,
	loadCallGraph,
	type CallGraph
} from '$lib/graph/callgraph';
import { book } from './book.svelte';

class CallGraphView {
	job = $state('');
	graph = $state<CallGraph | null>(null);
	root = $state('');
	/** paths (`root/callee/callee`) the user has opened */
	open = $state<string[]>([]);
	/** the root the canvas was last framed on; empty asks for one fit */
	framed = $state('');

	loading = $state(false);
	progress = $state('');
	error = $state('');

	/** guards against a slow load for an old job landing on a new one */
	#run = 0;

	get key() {
		return this.job && this.root ? `callgraph:${this.job}:${this.root}` : '';
	}

	/** Load once per job. A second call with the graph already in hand is a
	    no-op, which is what makes remounting the tab free. */
	async ensure(job: string, force = false) {
		if (!job) {
			this.#clear('');
			return;
		}
		if (job === this.job && this.graph && !force) return;
		if (job !== this.job) this.#clear(job);

		const run = ++this.#run;
		this.loading = true;
		this.error = '';
		this.progress = force ? 'rebuilding...' : 'loading...';
		try {
			const g = await loadCallGraph(job, {
				force,
				onProgress: (done, total) => {
					if (run === this.#run) this.progress = `reading functions ${done}/${total}`;
				}
			});
			if (run !== this.#run) return;
			this.graph = g;
			// The graph is every function's name and address -- the same book the
			// listing uses to turn `CALL 0x006341eb` into a name. Building it once
			// resolves the whole binary.
			book.learnMany(
				job,
				Object.values(g.nodes).map((n) => ({ address: n.addr, name: n.name }))
			);
			if (!this.root || !g.nodes[this.root]) {
				this.setRoot(g.roots[0] ?? Object.keys(g.nodes)[0] ?? '');
			}
		} catch (e) {
			if (run !== this.#run) return;
			this.graph = null;
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			if (run === this.#run) {
				this.loading = false;
				this.progress = '';
			}
		}
	}

	async rebuild(job: string) {
		await dropCallGraph(job);
		this.root = '';
		await this.ensure(job, true);
	}

	setRoot(addr: string) {
		if (!addr) return;
		if (this.graph && !this.graph.nodes[addr]) return;
		this.root = addr;
		this.open = [...(this.graph ? autoExpand(this.graph, addr) : [])];
		this.framed = ''; // a new root deserves one fit
	}

	opened(id: string) {
		return this.open.includes(id);
	}

	toggle(id: string) {
		if (this.opened(id)) {
			// closing a node closes everything under it, so reopening it does not
			// dump an old subtree back on screen
			this.open = this.open.filter((p) => p !== id && !p.startsWith(id + '/'));
		} else {
			this.open = [...this.open, id];
		}
	}

	collapse() {
		this.open = [];
	}

	#clear(job: string) {
		this.job = job;
		this.graph = null;
		this.root = '';
		this.open = [];
		this.framed = '';
		this.error = '';
	}
}

export const callGraphView = new CallGraphView();
