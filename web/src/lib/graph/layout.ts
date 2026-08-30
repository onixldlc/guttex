// Graph layout, ported from Cutter's `GraphGridLayout` (rizinorg/cutter,
// src/widgets/GraphGridLayout.cpp), which is where the disassembly graphs
// everyone recognises come from.
//
// The shape of the algorithm, in its own words:
//   1. select a subset of edges that form a DAG (remove cycles)
//   2. toposort the DAG
//   3. choose a subset of edges that form a tree and assign rows
//   4. place nodes on a grid using the tree, subtrees side by side, parent on top
//   5. route edges through the grid
//   6. turn grid cells into pixels using node sizes and the edge counts between rows
//
// Two things about it are deliberate and worth keeping in mind, because they are
// the opposite of a textbook layered layout:
//
// - There is no node reordering to minimise crossings. Reordering destroys the
//   thing a control-flow graph is read for -- the true branch staying on one
//   side and the false branch on the other -- and structured code lays out
//   readably without it.
// - Edges do not go wherever is shortest. Every edge picks one column for its
//   vertical run (its "main column"), preferring the column it starts in, then
//   the one it ends in, then the nearest column that is free for the rows it
//   crosses. Because nodes sit on a grid, a free column is free all the way
//   down, so no edge is ever drawn over a block.
//
// Not ported: the linear-program compaction pass (`optimizeLayout`), which is
// cosmetic -- everything it tightens is still correct without it.

export interface LayoutNode {
	id: string;
	w: number;
	h: number;
}

export interface LayoutEdge {
	from: string;
	to: string;
	kind?: string;
}

export interface Placed extends LayoutNode {
	x: number;
	y: number;
	/** grid row; kept named `rank` for the callers */
	rank: number;
	col: number;
}

export interface Route {
	from: string;
	to: string;
	kind?: string;
	/** polyline in content coordinates, source first */
	points: [number, number][];
	/** runs against the flow -- a loop */
	back?: boolean;
}

export interface Layout {
	nodes: Map<string, Placed>;
	routes: Route[];
	width: number;
	height: number;
}

export interface LayoutOpts {
	/** vertical space between rows of blocks */
	rankGap?: number;
	/** horizontal space between blocks */
	nodeGap?: number;
	/** entry node: kept at the top even when it sits inside a loop */
	root?: string;
}

/** Cutter's layoutConfig defaults. */
const EDGE_H = 10;
const EDGE_V = 10;

// Cutter's LayoutType::Medium.
const TIGHT_SUBTREE = false;
const PARENT_BETWEEN_CHILDREN = true;

interface GridBlock {
	id: string;
	w: number;
	h: number;
	row: number;
	col: number;
	/** outgoing edges that are part of the DAG, i.e. not loop edges */
	dag: string[];
	/** the subset of those that form the placement tree */
	tree: string[];
	hasParent: boolean;
	inputCount: number;
	outputCount: number;
	rowCount: number;
	lastRowLeft: number;
	lastRowRight: number;
	leftPosition: number;
	rightPosition: number;
	/** subtree contour: each entry is a column relative to the previous row */
	leftShape: number[];
	rightShape: number[];
	mergeBlock?: string;
}

interface GridPoint {
	row: number;
	col: number;
	kind: number;
	spacing: number;
	offset: number;
}

interface GridEdge {
	edge: LayoutEdge;
	from: string;
	dest: string;
	mainColumn: number;
	points: GridPoint[];
	secondaryPriority: number;
}

interface Segment {
	y0: number;
	y1: number;
	x: number;
	index: number;
	secondaryPriority: number;
	kind: number;
	spacing: number;
}

interface NodeSide {
	x: number;
	y0: number;
	y1: number;
	size: number;
}

export function layered(
	nodeList: LayoutNode[],
	edgeList: LayoutEdge[],
	opts: LayoutOpts = {}
): Layout {
	const blockVerticalSpacing = opts.rankGap ?? 40;
	const blockHorizontalSpacing = opts.nodeGap ?? 20;

	const g = new Map<string, GridBlock>();
	for (const n of nodeList) {
		g.set(n.id, {
			id: n.id,
			w: Math.max(1, Math.round(n.w)),
			h: Math.max(1, Math.round(n.h)),
			row: 0,
			col: 0,
			dag: [],
			tree: [],
			hasParent: false,
			inputCount: 0,
			outputCount: 0,
			rowCount: 0,
			lastRowLeft: 0,
			lastRowRight: 0,
			leftPosition: 0,
			rightPosition: 0,
			leftShape: [],
			rightShape: []
		});
	}
	const ids = nodeList.map((n) => n.id);
	if (!ids.length) return { nodes: new Map(), routes: [], width: 1, height: 1 };

	// Outgoing edges keep the caller's order. It carries meaning: Cutter emits
	// the false branch first and the true branch second, and ties in column
	// choice are broken by that index, which is what keeps true on one side and
	// false on the other.
	const outEdges = new Map<string, LayoutEdge[]>();
	for (const id of ids) outEdges.set(id, []);
	const edges = edgeList.filter((e) => g.has(e.from) && g.has(e.to));
	for (const e of edges) outEdges.get(e.from)!.push(e);

	const entry = opts.root && g.has(opts.root) ? opts.root : ids[0];

	// ---- 1/2. cycle removal and toposort, in one DFS ----
	const blockOrder = topoSort(g, outEdges, ids, entry);

	// ---- 3/4. rows, tree, placement ----
	assignRows(g, blockOrder);
	selectTree(g, blockOrder);
	findMergePoints(g, blockOrder);
	computeAllBlockPlacement(g, blockOrder, ids);

	let rows = 1;
	let columns = 1;
	for (const b of g.values()) {
		rows = Math.max(rows, b.row + 1);
		columns = Math.max(columns, b.col + 2); // a block is two columns wide
	}

	const rowHeight = new Array(rows).fill(0);
	let columnWidth = new Array(columns).fill(0);
	for (const b of g.values()) {
		rowHeight[b.row] = Math.max(rowHeight[b.row], b.h);
		const half = (b.w / 2) | 0;
		columnWidth[b.col] = Math.max(columnWidth[b.col], half);
		columnWidth[b.col + 1] = Math.max(columnWidth[b.col + 1], half);
	}

	// ---- 5. edge routing ----
	const gridEdges: GridEdge[] = [];
	const edgesOf = new Map<string, GridEdge[]>();
	for (const id of ids) {
		const list: GridEdge[] = [];
		for (const e of outEdges.get(id)!) {
			const ge: GridEdge = {
				edge: e,
				from: id,
				dest: e.to,
				mainColumn: -1,
				points: [],
				secondaryPriority: 0
			};
			list.push(ge);
			gridEdges.push(ge);
		}
		edgesOf.set(id, list);
		g.get(id)!.outputCount = list.length;
		for (const ge of list) g.get(ge.dest)!.inputCount++;
	}

	calculateEdgeMainColumn(g, ids, edgesOf, columns);
	roughRouting(g, ids, edgesOf);

	// ---- 6. grid to pixels ----
	const edgeColumnWidth = new Array(columns + 1).fill(blockHorizontalSpacing);
	edgeColumnWidth[0] = edgeColumnWidth[columns] = EDGE_H;
	const edgeRowHeight = new Array(rows + 1).fill(blockVerticalSpacing);
	edgeRowHeight[0] = edgeRowHeight[rows] = EDGE_V;

	// vertical segments: offsets within their edge column
	{
		const segments: Segment[] = [];
		let index = 0;
		for (const ge of gridEdges) {
			for (let j = 1; j < ge.points.length; j += 2) {
				segments.push({
					y0: ge.points[j - 1].row * 2,
					y1: ge.points[j].row * 2,
					x: ge.points[j].col,
					index: index++,
					kind: ge.points[j].kind,
					spacing: ge.points[j].spacing,
					secondaryPriority: ge.secondaryPriority
				});
			}
		}
		const leftSides: NodeSide[] = [];
		const rightSides: NodeSide[] = [];
		for (const b of g.values()) {
			const leftWidth = (b.w / 2) | 0;
			const rightWidth = b.w - leftWidth;
			const row = b.row * 2 + 1; // blocks sit in odd rows, edges in even ones
			leftSides.push({ x: b.col, y0: row, y1: row, size: leftWidth });
			rightSides.push({ x: b.col + 1, y0: row, y1: row, size: rightWidth });
		}
		const offsets = new Array(index).fill(0);
		calculateSegmentOffsets(
			segments,
			offsets,
			edgeColumnWidth,
			rightSides,
			leftSides,
			columnWidth,
			2 * rows + 1,
			EDGE_H
		);
		centerEdges(offsets, edgeColumnWidth, segments);

		// recompute column widths now that the edge columns have a size, then
		// shift the segments that ride along a column edge to match
		const oldColumnWidth = columnWidth.slice();
		columnWidth = new Array(columns).fill(0);
		for (const b of g.values()) {
			const w = ((b.w - edgeColumnWidth[b.col + 1]) / 2) | 0;
			columnWidth[b.col] = Math.max(columnWidth[b.col], w);
			columnWidth[b.col + 1] = Math.max(columnWidth[b.col + 1], w);
		}
		for (const s of segments) {
			if (s.kind === -2) {
				offsets[s.index] -=
					((edgeColumnWidth[s.x - 1] / 2) | 0) + columnWidth[s.x - 1] - oldColumnWidth[s.x - 1];
			} else if (s.kind === 2) {
				offsets[s.index] +=
					((edgeColumnWidth[s.x + 1] / 2) | 0) + columnWidth[s.x] - oldColumnWidth[s.x];
			}
		}

		index = 0;
		for (const ge of gridEdges) {
			for (let j = 1; j < ge.points.length; j += 2) {
				let offset = offsets[index++];
				// an end segment must stay within the block it touches
				const block =
					j === 1 ? g.get(ge.from) : j + 1 === ge.points.length ? g.get(ge.dest) : null;
				if (block) {
					const ecw = edgeColumnWidth[ge.points[j].col];
					offset = Math.max(-((block.w / 2) | 0) + ((ecw / 2) | 0), offset);
					offset = Math.min(((ecw / 2) | 0) + ((Math.min(block.w, ecw) / 2) | 0), offset);
				}
				ge.points[j].offset = offset;
			}
		}
	}

	const columnOffset: number[] = [];
	const edgeColumnOffset: number[] = [];
	const width = calculateColumnOffsets(columnWidth, edgeColumnWidth, columnOffset, edgeColumnOffset);

	// horizontal segments: offsets within their edge row, using the exact x
	// coordinates the vertical pass just produced
	{
		const segments: Segment[] = [];
		let index = 0;
		for (const ge of gridEdges) {
			for (let j = 2; j + 1 < ge.points.length; j += 2) {
				segments.push({
					y0: edgeColumnOffset[ge.points[j - 1].col] + ge.points[j - 1].offset,
					y1: edgeColumnOffset[ge.points[j + 1].col] + ge.points[j + 1].offset,
					x: ge.points[j].row,
					index: index++,
					kind: ge.points[j].kind,
					spacing: ge.points[j].spacing,
					secondaryPriority: ge.secondaryPriority
				});
			}
		}
		const leftSides: NodeSide[] = [];
		const rightSides: NodeSide[] = [];
		for (const b of g.values()) {
			const left =
				edgeColumnOffset[b.col + 1] + ((edgeColumnWidth[b.col + 1] / 2) | 0) - ((b.w / 2) | 0);
			const right = left + b.w;
			leftSides.push({ x: b.row, y0: left, y1: right, size: rowHeight[b.row] });
			rightSides.push({ x: b.row, y0: left, y1: right, size: b.h });
		}
		const h = compressCoordinates(segments, leftSides, rightSides);
		const offsets = new Array(index).fill(0);
		calculateSegmentOffsets(
			segments,
			offsets,
			edgeRowHeight,
			rightSides,
			leftSides,
			rowHeight,
			h,
			EDGE_V
		);
		index = 0;
		for (const ge of gridEdges) {
			for (let j = 2; j + 1 < ge.points.length; j += 2) ge.points[j].offset = offsets[index++];
		}
	}

	const rowOffset: number[] = [];
	const edgeRowOffset: number[] = [];
	const height = calculateColumnOffsets(rowHeight, edgeRowHeight, rowOffset, edgeRowOffset);

	// ---- node pixel positions ----
	const nodes = new Map<string, Placed>();
	for (const b of g.values()) {
		nodes.set(b.id, {
			id: b.id,
			w: b.w,
			h: b.h,
			rank: b.row,
			col: b.col,
			x: edgeColumnOffset[b.col + 1] + ((edgeColumnWidth[b.col + 1] / 2) | 0) - ((b.w / 2) | 0),
			y: rowOffset[b.row]
		});
	}

	// ---- edge polylines ----
	const routes: Route[] = [];
	for (const ge of gridEdges) {
		const src = nodes.get(ge.from)!;
		const dst = nodes.get(ge.dest)!;
		const pts: [number, number][] = [[0, src.y + src.h]];
		for (let j = 1; j < ge.points.length; j++) {
			if (j & 1) {
				const x = edgeColumnOffset[ge.points[j].col] + ge.points[j].offset;
				pts[pts.length - 1][0] = x;
				pts.push([x, 0]);
			} else {
				const y = edgeRowOffset[ge.points[j].row] + ge.points[j].offset;
				pts[pts.length - 1][1] = y;
				pts.push([0, y]);
			}
		}
		pts[0][1] = src.y + src.h;
		pts[pts.length - 1][1] = dst.y;
		if (pts.length > 1) pts[pts.length - 1][0] = pts[pts.length - 2][0];
		routes.push({
			from: ge.from,
			to: ge.dest,
			kind: ge.edge.kind,
			back: g.get(ge.dest)!.row <= g.get(ge.from)!.row,
			points: pts
		});
	}

	return { nodes, routes, width, height };
}

// --------------------------------------------------------------- 1/2. toposort

function topoSort(
	g: Map<string, GridBlock>,
	outEdges: Map<string, LayoutEdge[]>,
	ids: string[],
	entry: string
): string[] {
	const order: string[] = [];
	// 0 not visited, 1 on the stack, 2 done
	const state = new Map<string, 0 | 1 | 2>();
	const walk = (first: string) => {
		state.set(first, 1);
		const stack: { id: string; i: number }[] = [{ id: first, i: 0 }];
		while (stack.length) {
			const top = stack[stack.length - 1];
			const es = outEdges.get(top.id)!;
			if (top.i < es.length) {
				const target = es[top.i++].to;
				const s = state.get(target) ?? 0;
				if (s === 0) {
					state.set(target, 1);
					g.get(top.id)!.dag.push(target);
					stack.push({ id: target, i: 0 });
				} else if (s === 2) {
					g.get(top.id)!.dag.push(target);
				}
				// s === 1: the target is on the stack, so this is a loop edge
			} else {
				stack.pop();
				state.set(top.id, 2);
				order.push(top.id);
			}
		}
	};
	// entry first, so a function whose entry is inside a loop still starts at the top
	walk(entry);
	for (const id of ids) if (!state.get(id)) walk(id);
	return order;
}

function assignRows(g: Map<string, GridBlock>, order: string[]) {
	for (let i = order.length - 1; i >= 0; i--) {
		const b = g.get(order[i])!;
		for (const t of b.dag) {
			const target = g.get(t)!;
			target.row = Math.max(target.row, b.row + 1);
		}
	}
}

/** Reduce the DAG to a tree: the first unclaimed child exactly one row below. */
function selectTree(g: Map<string, GridBlock>, order: string[]) {
	for (let i = order.length - 1; i >= 0; i--) {
		const b = g.get(order[i])!;
		for (const t of b.dag) {
			const target = g.get(t)!;
			if (!target.hasParent && target.row === b.row + 1) {
				b.tree.push(t);
				target.hasParent = true;
			}
		}
	}
}

/**
 * Where control flow splits and comes back together, nudge the child columns so
 * the join lands centred under the branch above it.
 */
function findMergePoints(g: Map<string, GridBlock>, order: string[]) {
	for (const id of order) {
		const block = g.get(id)!;
		let merge: GridBlock | null = null;
		let grandChildren = 0;
		for (const t of block.tree) {
			const target = g.get(t)!;
			if (target.tree.length) merge = g.get(target.tree[0])!;
			grandChildren += target.tree.length;
		}
		if (!merge || grandChildren !== 1) continue;
		let goingToMerge = 0;
		let withTreeEdge = 0;
		for (const t of block.tree) {
			const target = g.get(t)!;
			if (!target.dag.includes(merge.id)) break;
			if (target.tree.length === 1) withTreeEdge = goingToMerge;
			goingToMerge++;
		}
		if (goingToMerge) {
			block.mergeBlock = merge.id;
			g.get(block.tree[withTreeEdge])!.col = withTreeEdge * 2 - (goingToMerge - 1);
		}
	}
}

// ------------------------------------------------------------- 4. node placement

function computeAllBlockPlacement(g: Map<string, GridBlock>, order: string[], ids: string[]) {
	// Subtree shapes are contours: each entry is a column relative to the row
	// above, so shifting a whole subtree is a change to one number.
	for (const id of order) {
		const b = g.get(id)!;
		if (b.tree.length === 0) {
			b.rowCount = 1;
			b.col = 0;
			b.lastRowRight = 2;
			b.lastRowLeft = 0;
			b.leftPosition = 0;
			b.rightPosition = 2;
			b.leftShape = [0];
			b.rightShape = [2];
			continue;
		}
		const first = g.get(b.tree[0])!;
		let leftSide = first.leftShape.slice();
		let rightSide = first.rightShape.slice();
		b.rowCount = first.rowCount;
		b.lastRowRight = first.lastRowRight;
		b.lastRowLeft = first.lastRowLeft;
		b.leftPosition = first.leftPosition;
		b.rightPosition = first.rightPosition;

		for (let i = 1; i < b.tree.length; i++) {
			const child = g.get(b.tree[i])!;
			const childLeft = child.leftShape.slice();
			let minPos = -Infinity;
			let leftPos = 0;
			let rightPos = 0;
			let maxLeftWidth = 0;
			let minRightPos = child.col;
			let li = 0;
			let ri = 0;
			// walk the part of the two subtrees that touches when set side by side
			while (li < rightSide.length && ri < childLeft.length) {
				leftPos += rightSide[li];
				rightPos += childLeft[ri];
				minPos = Math.max(minPos, leftPos - rightPos);
				maxLeftWidth = Math.max(maxLeftWidth, leftPos);
				minRightPos = Math.min(minRightPos, rightPos);
				li++;
				ri++;
			}
			let offset: number;
			if (TIGHT_SUBTREE) {
				offset = minPos; // as close as the two shapes allow
			} else if (li < rightSide.length) {
				// use the bounding box of the shorter subtree: slightly sparser,
				// and much easier to follow
				offset = maxLeftWidth - child.leftPosition;
			} else {
				offset = b.rightPosition - minRightPos;
			}
			child.col += offset;
			if (li < rightSide.length) {
				rightSide[li] -= offset + child.lastRowRight - leftPos;
				rightSide = child.rightShape.slice().concat(rightSide.slice(li));
			} else if (ri < childLeft.length) {
				childLeft[ri] += rightPos + offset - b.lastRowLeft;
				leftSide = leftSide.concat(childLeft.slice(ri));
				rightSide = child.rightShape.slice();
				b.lastRowRight = child.lastRowRight + offset;
				b.lastRowLeft = child.lastRowLeft + offset;
			} else {
				rightSide = child.rightShape.slice();
			}
			rightSide[0] += offset;
			b.rowCount = Math.max(b.rowCount, child.rowCount);
			b.leftPosition = Math.min(b.leftPosition, child.leftPosition + offset);
			b.rightPosition = Math.max(b.rightPosition, offset + child.rightPosition);
		}

		let col = 0;
		if (PARENT_BETWEEN_CHILDREN) {
			// keep one child to the left and the other to the right
			for (const t of b.tree) col += g.get(t)!.col;
			col = Math.trunc(col / b.tree.length);
		} else {
			col = Math.trunc((b.rightPosition + b.leftPosition) / 2) - 1;
			col = Math.max(col, g.get(b.tree[0])!.col - 1);
			col = Math.min(col, g.get(b.tree[b.tree.length - 1])!.col + 1);
		}
		b.col += col;
		b.rowCount += 1;
		b.leftPosition = Math.min(b.leftPosition, b.col);
		b.rightPosition = Math.max(b.rightPosition, b.col + 2);

		leftSide[0] -= b.col;
		b.leftShape = [b.col, ...leftSide];
		rightSide[0] -= b.col + 2;
		b.rightShape = [b.col + 2, ...rightSide];

		// children stay relative to the parent, so moving a parent moves its subtree
		for (const t of b.tree) g.get(t)!.col -= b.col;
	}

	// roots side by side, then relative columns become absolute top down
	let nextEmptyColumn = 0;
	for (const id of ids) {
		const b = g.get(id)!;
		if (b.row === 0) {
			const offset = -b.leftPosition;
			b.col += nextEmptyColumn + offset;
			nextEmptyColumn = b.rightPosition + offset + nextEmptyColumn;
		}
	}
	for (let i = order.length - 1; i >= 0; i--) {
		const b = g.get(order[i])!;
		for (const t of b.tree) g.get(t)!.col += b.col;
	}
}

// ---------------------------------------------------------------- 5. routing

/**
 * Pick the column each edge uses for its vertical run. Sweep the rows top to
 * bottom keeping, per column, the last row a block blocked it at; an edge takes
 * its own column if that is still free over the rows it crosses, else the
 * target's, else the nearest free one.
 */
function calculateEdgeMainColumn(
	g: Map<string, GridBlock>,
	ids: string[],
	edgesOf: Map<string, GridEdge[]>,
	columns: number
) {
	type Event = { id: string; edge: number; row: number; block: boolean };
	const events: Event[] = [];
	for (const id of ids) {
		const b = g.get(id)!;
		events.push({ id, edge: 0, row: b.row, block: true });
		edgesOf.get(id)!.forEach((ge, i) => {
			const target = g.get(ge.dest)!;
			events.push({ id, edge: i, row: Math.max(b.row + 1, target.row), block: false });
		});
	}
	// edges before blocks within a row, matching Cutter's event ordering
	events.sort((a, b) => a.row - b.row || Number(a.block) - Number(b.block));

	const blockedAt = new Array(columns + 1).fill(-1);
	for (const ev of events) {
		const block = g.get(ev.id)!;
		if (ev.block) {
			blockedAt[block.col + 1] = ev.row;
			continue;
		}
		const ge = edgesOf.get(ev.id)![ev.edge];
		const target = g.get(ge.dest)!;
		const column = block.col + 1;
		const targetColumn = target.col + 1;
		const topRow = Math.min(block.row + 1, target.row);

		if (blockedAt[column] < topRow) {
			ge.mainColumn = column; // fewest segments
			continue;
		}
		if (blockedAt[targetColumn] < topRow) {
			ge.mainColumn = targetColumn;
			continue;
		}
		let left = -1;
		for (let c = column; c >= 0; c--)
			if (blockedAt[c] < topRow) {
				left = c;
				break;
			}
		let right = -1;
		for (let c = column; c <= columns; c++)
			if (blockedAt[c] < topRow) {
				right = c;
				break;
			}
		if (left < 0 && right < 0) {
			ge.mainColumn = column;
			continue;
		}
		if (left < 0) {
			ge.mainColumn = right;
			continue;
		}
		if (right < 0) {
			ge.mainColumn = left;
			continue;
		}
		const distanceLeft = column - left + Math.abs(targetColumn - left);
		const distanceRight = right - column + Math.abs(targetColumn - right);

		// An upward edge is drawn as a loop out to one side rather than a figure
		// 8 crossing itself between the two blocks.
		if (target.row < block.row) {
			if (
				targetColumn < column &&
				blockedAt[column + 1] < topRow &&
				column - targetColumn <= distanceLeft + 2
			) {
				ge.mainColumn = column + 1;
				continue;
			}
			if (
				targetColumn > column &&
				blockedAt[column - 1] < topRow &&
				targetColumn - column <= distanceRight + 2
			) {
				ge.mainColumn = column - 1;
				continue;
			}
		}
		if (distanceLeft !== distanceRight) {
			ge.mainColumn = distanceLeft < distanceRight ? left : right;
		} else {
			// tie: split by edge index, which keeps true branches on one side
			ge.mainColumn = ev.edge < edgesOf.get(ev.id)!.length / 2 ? left : right;
		}
	}
}

/** At most five segments: down, across to the main column, down, across, down. */
function roughRouting(g: Map<string, GridBlock>, ids: string[], edgesOf: Map<string, GridEdge[]>) {
	const spacingOverride = (blockWidth: number, edgeCount: number) => {
		if (!edgeCount) return 0;
		const maxSpacing = (blockWidth / edgeCount) | 0;
		return maxSpacing < EDGE_H ? Math.max(maxSpacing, 1) : 0;
	};

	for (const id of ids) {
		const start = g.get(id)!;
		for (const ge of edgesOf.get(id)!) {
			const target = g.get(ge.dest)!;
			const add = (row: number, col: number, kind = 0) =>
				ge.points.push({ row, col, kind, spacing: 0, offset: 0 });

			add(start.row + 1, start.col + 1);
			if (ge.mainColumn !== start.col + 1) {
				add(start.row + 1, start.col + 1, ge.mainColumn < start.col + 1 ? -1 : 1);
				add(start.row + 1, ge.mainColumn, target.row <= start.row ? -2 : 0);
			}
			let mainKind = 0;
			if (ge.mainColumn < start.col + 1 && ge.mainColumn < target.col + 1) mainKind = 2;
			else if (ge.mainColumn > start.col + 1 && ge.mainColumn > target.col + 1) mainKind = -2;
			else if (ge.mainColumn === start.col + 1 && ge.mainColumn !== target.col + 1)
				mainKind = ge.mainColumn < target.col + 1 ? 1 : -1;
			else if (ge.mainColumn === target.col + 1 && ge.mainColumn !== start.col + 1)
				mainKind = ge.mainColumn < start.col + 1 ? 1 : -1;
			add(target.row, ge.mainColumn, mainKind);
			if (target.col + 1 !== ge.mainColumn) {
				add(target.row, target.col + 1, target.row <= start.row ? 2 : 0);
				add(target.row, target.col + 1, target.col + 1 < ge.mainColumn ? 1 : -1);
			}

			// tighten spacing where one block has a great many edges
			const startOverride = spacingOverride(start.w, start.outputCount);
			const targetOverride = spacingOverride(target.w, target.inputCount);
			ge.points[0].spacing = startOverride;
			ge.points[ge.points.length - 1].spacing = targetOverride;
			if (ge.points.length <= 2) {
				if (startOverride && startOverride < targetOverride)
					ge.points[ge.points.length - 1].spacing = startOverride;
			} else {
				ge.points[1].spacing = startOverride;
			}

			let length = 0;
			for (let i = 1; i < ge.points.length; i++) {
				length +=
					Math.abs(ge.points[i].row - ge.points[i - 1].row) +
					Math.abs(ge.points[i].col - ge.points[i - 1].col);
			}
			ge.secondaryPriority = 2 * length + (target.row >= start.row ? 1 : 0);
		}
	}
}

/**
 * Give every segment an offset within its column so no two overlap. Greedy, in
 * an order chosen to keep crossings down: by column, then by which side of the
 * column the segment belongs on, then by length.
 *
 * Written for vertical segments; the horizontal pass calls it with the axes
 * swapped.
 */
function calculateSegmentOffsets(
	segments: Segment[],
	edgeOffsets: number[],
	edgeColumnWidth: number[],
	nodeRightSide: NodeSide[],
	nodeLeftSide: NodeSide[],
	columnWidth: number[],
	h: number,
	segmentSpacing: number
) {
	for (const s of segments) if (s.y0 > s.y1) [s.y0, s.y1] = [s.y1, s.y0];

	segments.sort((a, b) => {
		if (a.x !== b.x) return a.x - b.x;
		if (a.kind !== b.kind) return a.kind - b.kind;
		const aSize = a.y1 - a.y0;
		const bSize = b.y1 - b.y0;
		if (aSize !== bSize) return a.kind !== 1 ? aSize - bSize : bSize - aSize;
		return a.kind !== 1
			? a.secondaryPriority - b.secondaryPriority
			: b.secondaryPriority - a.secondaryPriority;
	});
	const right = [...nodeRightSide].sort((a, b) => a.x - b.x);
	const left = [...nodeLeftSide].sort((a, b) => a.x - b.x);

	const line = new Array(Math.max(1, h)).fill(-Infinity);
	const setRange = (l: number, r: number, v: number) => {
		for (let i = Math.max(0, l); i < Math.min(line.length, r); i++) line[i] = v;
	};
	const rangeMax = (l: number, r: number) => {
		let m = -Infinity;
		for (let i = Math.max(0, l); i < Math.min(line.length, r); i++) m = Math.max(m, line[i]);
		return m === -Infinity ? 0 : m;
	};

	let si = 0;
	let ri = 0;
	let li = 0;
	while (si < segments.length) {
		const x = segments[si].x;

		// segments left of the column centre, measured against the blocks on that side
		const leftColumnWidth = x > 0 ? columnWidth[x - 1] : 0;
		setRange(0, line.length, -leftColumnWidth);
		while (ri < right.length && right[ri].x + 1 < x) ri++;
		while (ri < right.length && right[ri].x + 1 === x) {
			setRange(right[ri].y0, right[ri].y1 + 1, right[ri].size - leftColumnWidth);
			ri++;
		}
		while (si < segments.length && segments[si].x === x && segments[si].kind <= 1) {
			const s = segments[si];
			let y = rangeMax(s.y0, s.y1 + 1);
			if (s.kind !== -2) y = Math.max(y, 0);
			y += s.spacing || segmentSpacing;
			setRange(s.y0, s.y1 + 1, y);
			edgeOffsets[s.index] = y;
			si++;
		}

		const firstRight = si;
		const middleWidth = Math.max(rangeMax(0, line.length), 0);

		// then the ones on the right, packed inward from the far side
		const rightColumnWidth = x < columnWidth.length ? columnWidth[x] : 0;
		setRange(0, line.length, -rightColumnWidth);
		while (li < left.length && left[li].x < x) li++;
		while (li < left.length && left[li].x === x) {
			setRange(left[li].y0, left[li].y1 + 1, left[li].size - rightColumnWidth);
			li++;
		}
		while (si < segments.length && segments[si].x === x) {
			const s = segments[si];
			let y = rangeMax(s.y0, s.y1 + 1);
			y += s.spacing || segmentSpacing;
			setRange(s.y0, s.y1 + 1, y);
			edgeOffsets[s.index] = y;
			si++;
		}
		let rightMiddle = Math.max(rangeMax(0, line.length), 0);
		rightMiddle = Math.max(rightMiddle, edgeColumnWidth[x] - middleWidth - segmentSpacing);
		for (let i = firstRight; i < si; i++) {
			const s = segments[i];
			edgeOffsets[s.index] = middleWidth + (rightMiddle - edgeOffsets[s.index]) + segmentSpacing;
		}
		edgeColumnWidth[x] = middleWidth + segmentSpacing + rightMiddle;
	}
}

/**
 * Centre each run of segments within its column.
 *
 * Offsets come out of the packing pass stacked from one side, so a column
 * carrying a single edge puts it one spacing in from the left rather than down
 * the middle -- which is what makes a lone arrow arrive off-centre on the block
 * below. Segments are split into chunks that do not overlap vertically, and
 * each chunk is centred on its own.
 */
function centerEdges(offsets: number[], edgeColumnWidth: number[], segments: Segment[]) {
	type Ev = { x: number; y: number; index: number; start: boolean };
	const events: Ev[] = [];
	for (const s of segments) {
		const offset = offsets[s.index];
		// Leave alone anything sitting outside its column, between the blocks:
		// moving those cannot be done without risking an overlap with a block.
		if (offset >= 0 && offset <= edgeColumnWidth[s.x]) {
			events.push({ x: s.x, y: s.y0, index: s.index, start: true });
			events.push({ x: s.x, y: s.y1, index: s.index, start: false });
		}
	}
	// starts before ends at equal y, so the active count only reaches zero at
	// the end of a chunk
	events.sort((a, b) => a.x - b.x || a.y - b.y || Number(b.start) - Number(a.start));

	let i = 0;
	while (i < events.length) {
		const chunkStart = i;
		const x = events[i].x;
		let left = offsets[events[i].index];
		let right = left;
		i++;
		let active = 1;
		while (active > 0 && i < events.length) {
			active += events[i].start ? 1 : -1;
			const offset = offsets[events[i].index];
			left = Math.min(left, offset);
			right = Math.max(right, offset);
			i++;
		}
		const shift = (((edgeColumnWidth[x] - (right - left)) / 2) | 0) - left;
		for (let k = chunkStart; k < i; k++) {
			if (events[k].start) offsets[events[k].index] += shift;
		}
	}
}

/** Map the pixel coordinates the horizontal pass works in onto dense indices. */
function compressCoordinates(
	segments: Segment[],
	leftSides: NodeSide[],
	rightSides: NodeSide[]
): number {
	const positions = new Set<number>();
	for (const s of segments) {
		positions.add(s.y0);
		positions.add(s.y1);
	}
	for (const s of leftSides) {
		positions.add(s.y0);
		positions.add(s.y1);
	}
	const sorted = [...positions].sort((a, b) => a - b);
	const index = new Map(sorted.map((v, i) => [v, i]));
	for (const s of segments) {
		s.y0 = index.get(s.y0)!;
		s.y1 = index.get(s.y1)!;
	}
	for (let i = 0; i < leftSides.length; i++) {
		leftSides[i].y0 = rightSides[i].y0 = index.get(leftSides[i].y0)!;
		leftSides[i].y1 = rightSides[i].y1 = index.get(leftSides[i].y1)!;
	}
	return sorted.length;
}

/** Interleave node columns with the edge columns between them. */
function calculateColumnOffsets(
	columnWidth: number[],
	edgeColumnWidth: number[],
	columnOffset: number[],
	edgeColumnOffset: number[]
): number {
	let position = 0;
	for (let i = 0; i < columnWidth.length; i++) {
		edgeColumnOffset[i] = position;
		position += edgeColumnWidth[i];
		columnOffset[i] = position;
		position += columnWidth[i];
	}
	edgeColumnOffset[columnWidth.length] = position;
	position += edgeColumnWidth[columnWidth.length];
	return position;
}
