// Every centre view guttex has, in one place.
//
// This is the *catalogue*, not the layout. It says what views exist, what they
// are called and which component draws each -- the part that is the same on a
// desktop and a phone. It says nothing about tab bars, sizes or containers,
// because those are genuinely different on the two screens and should stay
// that way: the desktop uses `TabStrip` inside a `panel-head`, the phone uses
// a scrolling `Chips` row, and neither is a worse version of the other.
//
// Before this the list lived twice -- once in `routes/j/[id]` and once in
// `routes/mobile/[id]` -- with a hand-written `{#if}` chain under each. The two
// had already drifted: the phone had a `details` tab the desktop did not, and
// its extra tab was not a `CenterTab`, so the route had to special-case it in
// a way that fought `session.tab`.
//
// `at` carries a position per screen instead of one shared order. The phone
// leads with the decompiler because that is what you open a function to read;
// the desktop leads with the listing. Same catalogue, two orders, no second
// list to forget.

import type { Component } from 'svelte';
import CallGraph from '$components/CallGraph.svelte';
import Decompiler from '$components/Decompiler.svelte';
import Disassembly from '$components/Disassembly.svelte';
import FunctionGraph from '$components/FunctionGraph.svelte';
import HexView from '$components/HexView.svelte';
import InfoPanel from '$components/InfoPanel.svelte';
import XrefsPanel from '$components/XrefsPanel.svelte';

export type Screen = 'desktop' | 'phone';

export type View = {
	id: string;
	label: string;
	component: Component;
	/** where it sits on each screen; absent means it is not offered there */
	at: Partial<Record<Screen, number>>;
	/**
	 * False for a view that is a tab on one screen without being a centre view
	 * anywhere. The phone shows the right-hand dock as `details`; selecting it
	 * must not be written into `session.tab`, which has no such value and would
	 * be thrown off it by the next thing that sets a real tab.
	 */
	centre?: boolean;
};

export const VIEWS: View[] = [
	{ id: 'disasm', label: 'disassembly', component: Disassembly, at: { desktop: 1, phone: 2 } },
	{ id: 'graph', label: 'graph', component: FunctionGraph, at: { desktop: 2, phone: 3 } },
	{ id: 'decompiler', label: 'decompiler', component: Decompiler, at: { desktop: 3, phone: 1 } },
	{ id: 'hex', label: 'hexdump', component: HexView, at: { desktop: 4, phone: 5 } },
	{ id: 'callgraph', label: 'call graph', component: CallGraph, at: { desktop: 5, phone: 6 } },
	{ id: 'info', label: 'info', component: InfoPanel, at: { desktop: 6, phone: 7 } },
	// Phone only, and not a centre view: on the desktop this is the right-hand
	// dock, which is always on screen and needs no tab.
	{ id: 'details', label: 'details', component: XrefsPanel, at: { phone: 4 }, centre: false }
];

/** the views this screen offers, in this screen's order */
export function viewsFor(screen: Screen): View[] {
	return VIEWS.filter((v) => v.at[screen] !== undefined).sort(
		(a, b) => (a.at[screen] as number) - (b.at[screen] as number)
	);
}

/** true when picking this view should be written into `session.tab` */
export const isCentre = (id: string): boolean =>
	VIEWS.find((v) => v.id === id)?.centre !== false;
