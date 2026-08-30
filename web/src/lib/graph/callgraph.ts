// The global graph: who calls whom across the whole binary.
//
// ghidra-rest already knows the edges -- every function entry carries `calls`
// and `called_by` -- so building this is one paged walk of the function list.
// On a 30k-function binary that walk is the expensive part, and it never
// changes for a finished job, so the result is cached in IndexedDB and read
// back on later visits. Rendering stays cheap because the view only ever draws
// the branches that are expanded.

import { api } from '$lib/api/client';
import type { FunctionEntry } from '$lib/api/types';
import { normAddr } from '$lib/format';
import { cache } from './cache';

/** bump when the shape below changes, so old entries are ignored, not crashed on */
export const CALLGRAPH_VERSION = 1;

export interface CallGraphNode {
	addr: string;
	name: string;
	/** call targets, normalised addresses, in Ghidra's order */
	calls: string[];
	callers: number;
	ext?: boolean;
	thunk?: boolean;
}

export interface CallGraph {
	v: number;
	job: string;
	built: string;
	/** entry points first, then anything nothing calls */
	roots: string[];
	nodes: Record<string, CallGraphNode>;
	count: number;
}

const PAGE = 1000;
const key = (job: string) => `callgraph:${job}:v${CALLGRAPH_VERSION}`;

function toNode(f: FunctionEntry): CallGraphNode {
	return {
		addr: normAddr(f.address),
		name: f.name,
		calls: (f.calls ?? []).map((c) => normAddr(c.address)).filter(Boolean),
		callers: (f.called_by ?? []).length,
		...(f.is_external ? { ext: true } : {}),
		...(f.is_thunk ? { thunk: true } : {})
	};
}

async function build(job: string, onProgress?: (done: number, total: number) => void) {
	const nodes: Record<string, CallGraphNode> = {};
	let offset = 0;
	let total = 0;
	do {
		const page = await api.functions(job, { limit: PAGE, offset });
		total = page.total;
		for (const f of page.items) {
			const n = toNode(f);
			if (n.addr) nodes[n.addr] = n;
		}
		offset += page.count || PAGE;
		onProgress?.(Math.min(offset, total), total);
	} while (offset < total);

	// Roots: the binary's own entry points, then everything nothing calls --
	// that second set is where static libraries, callbacks and unreferenced
	// code show up, and it is the only way to reach them from a tree.
	const summary = await api.summary(job).catch(() => null);
	const entries = (summary?.entry_points ?? []).map(normAddr).filter((a) => nodes[a]);
	const orphans = Object.values(nodes)
		.filter((n) => !n.callers && !entries.includes(n.addr) && !n.ext)
		.sort((a, b) => b.calls.length - a.calls.length || a.addr.localeCompare(b.addr))
		.map((n) => n.addr);

	const graph: CallGraph = {
		v: CALLGRAPH_VERSION,
		job,
		built: new Date().toISOString(),
		roots: [...entries, ...orphans],
		nodes,
		count: Object.keys(nodes).length
	};
	await cache.put(key(job), graph);
	return graph;
}

/** Cached graph for a job, building it only when there is nothing usable stored. */
export async function loadCallGraph(
	job: string,
	opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {}
): Promise<CallGraph> {
	if (!opts.force) {
		const hit = await cache.get<CallGraph>(key(job));
		if (hit && hit.v === CALLGRAPH_VERSION && hit.nodes) return hit;
	}
	return build(job, opts.onProgress);
}

export function dropCallGraph(job: string) {
	return cache.del(key(job));
}

// ------------------------------------------------------------------ the tree

export interface TreeNode {
	/** the path that got here: `root/callee/callee`. Unique per drawn node. */
	id: string;
	addr: string;
	name: string;
	depth: number;
	kids: number;
	/** this address is already on its own path -- expanding would not end */
	recursive?: boolean;
	ext?: boolean;
	thunk?: boolean;
}

export interface Tree {
	nodes: TreeNode[];
	edges: { from: string; to: string }[];
	/** hit the node cap and stopped drawing */
	capped: boolean;
}

/**
 * Walk the graph from `root`, following only what the user has opened. Nothing
 * below a closed node is built at all, which is what keeps a 30k-function
 * binary interactive.
 */
export function buildTree(
	graph: CallGraph,
	root: string,
	expanded: Set<string>,
	limit = 600
): Tree {
	const nodes: TreeNode[] = [];
	const edges: { from: string; to: string }[] = [];
	let capped = false;

	const start = graph.nodes[root];
	if (!start) return { nodes, edges, capped };

	const walk = (addr: string, path: string, depth: number, seen: Set<string>) => {
		const n = graph.nodes[addr];
		const recursive = seen.has(addr);
		nodes.push({
			id: path,
			addr,
			name: n?.name ?? addr,
			depth,
			kids: recursive ? 0 : (n?.calls.length ?? 0),
			...(recursive ? { recursive: true } : {}),
			...(n?.ext ? { ext: true } : {}),
			...(n?.thunk ? { thunk: true } : {})
		});
		if (recursive || !n || !expanded.has(path)) return;
		for (const c of n.calls) {
			if (nodes.length >= limit) {
				capped = true;
				return;
			}
			const kid = `${path}/${c}`;
			edges.push({ from: path, to: kid });
			walk(c, kid, depth + 1, new Set([...seen, addr]));
		}
	};

	walk(root, root, 0, new Set());
	return { nodes, edges, capped };
}

/** Open the first few levels, stopping before the view gets unreadable. */
export function autoExpand(graph: CallGraph, root: string, budget = 60): Set<string> {
	const open = new Set<string>();
	let drawn = 1;
	let frontier: { addr: string; path: string; seen: Set<string> }[] = [
		{ addr: root, path: root, seen: new Set() }
	];
	for (let depth = 0; depth < 3 && frontier.length; depth++) {
		const next: typeof frontier = [];
		for (const f of frontier) {
			const n = graph.nodes[f.addr];
			if (!n || f.seen.has(f.addr)) continue;
			if (drawn + n.calls.length > budget) return open;
			open.add(f.path);
			drawn += n.calls.length;
			for (const c of n.calls) {
				next.push({ addr: c, path: `${f.path}/${c}`, seen: new Set([...f.seen, f.addr]) });
			}
		}
		frontier = next;
	}
	return open;
}
