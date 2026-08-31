// Which front end this screen should get.
//
// The workbench is two docks, a centre and a splitter -- it needs roughly a
// thousand pixels before it stops being a pile of overlapping tab labels. So
// the choice is made once, here, and every link to a job asks for the href
// rather than hardcoding `/j/`.
//
// This is a media query, not a user-agent sniff: what matters is how much room
// the layout has, and a phone in landscape or a desktop window dragged narrow
// are the same problem. The coarse-pointer arm catches tablets, which have the
// width but not the mouse the right-click menu and the splitters assume.

import { browser } from '$app/environment';

const QUERY = '(max-width: 820px), (pointer: coarse) and (max-width: 1180px)';

class Device {
	/** true when the viewport is too small (or too touch-only) for /j/ */
	phone = $state(false);

	constructor() {
		if (!browser) return;
		const mq = window.matchMedia(QUERY);
		this.phone = mq.matches;
		// rotating the phone or resizing the window re-decides it live
		mq.addEventListener('change', (e) => (this.phone = e.matches));
	}

	/** where a link to job `id` should point on this screen */
	job(id: string) {
		return `${this.phone ? '/mobile' : '/j'}/${id}`;
	}
}

export const device = new Device();
