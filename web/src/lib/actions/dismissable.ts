// Everything that floats closes the same way.
//
// Menus and dialogs share no layout at all -- a dropdown under the brand, a
// context menu at the pointer, a modal centred at 18vh -- but they share every
// rule about *when they go away*: Escape, a press somewhere else, and (for a
// menu pinned to a place on screen) anything that moves that place.
//
// Before this, four menus and four dialogs each wrote their own copy of those
// listeners, and they had drifted: the signature dialog refused to close on
// Escape while it was busy, but its backdrop closed it anyway.
//
// The action owns behaviour only. Position, size, z-index and chrome stay with
// whoever mounts it, which is the whole point -- a phone sheet and a desktop
// dropdown want the same rules and nothing else in common.

export type DismissOptions = {
	/** what to run when the user dismisses */
	onclose: () => void;
	/**
	 * false suspends dismissal without unmounting -- a dialog mid-request that
	 * must not vanish out from under the answer it is waiting for.
	 */
	enabled?: boolean;
	/**
	 * Dismiss on a press outside the node. On for menus; off for modals, whose
	 * backdrop is a real element and handles its own clicks (see Scrim).
	 */
	outside?: boolean;
	/** Dismiss on Escape. */
	escape?: boolean;
	/**
	 * Also dismiss on anything that moves the node out from under the pointer:
	 * a resize, losing the window, or a scroll somewhere else. For menus placed
	 * at fixed coordinates, which would otherwise be left pointing at nothing.
	 */
	volatile?: boolean;
};

export function dismissable(node: HTMLElement, options: DismissOptions) {
	let o = options;
	const live = () => o.enabled !== false;
	const outside = (t: EventTarget | null) => !node.contains(t as Node);

	const onKey = (e: KeyboardEvent) => {
		if (live() && o.escape !== false && e.key === 'Escape') o.onclose();
	};
	// pointerdown rather than click: a press outside should dismiss even when
	// it lands on something that swallows the click. Press, not release, so
	// the menu is gone before the thing underneath reacts.
	const onDown = (e: PointerEvent) => {
		if (live() && o.outside !== false && outside(e.target)) o.onclose();
	};
	const onGone = () => {
		if (live() && o.volatile) o.onclose();
	};
	// capture, because scrolls inside a pane do not bubble to the document
	const onScroll = (e: Event) => {
		if (live() && o.volatile && outside(e.target)) o.onclose();
	};

	document.addEventListener('keydown', onKey);
	document.addEventListener('pointerdown', onDown);
	document.addEventListener('scroll', onScroll, true);
	window.addEventListener('resize', onGone);
	window.addEventListener('blur', onGone);

	return {
		update(next: DismissOptions) {
			o = next;
		},
		destroy() {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onDown);
			document.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onGone);
			window.removeEventListener('blur', onGone);
		}
	};
}
