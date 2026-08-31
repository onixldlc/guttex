// Cross-site request protection, done by host rather than by full origin.
//
// SvelteKit ships this check and we had it on. It compares the browser's
// `Origin` against the origin the server believes it has -- and adapter-node,
// with no `ORIGIN` set, assumes https. guttex is served over plain http on a
// loopback port, so every upload from its own page compared
// `http://127.0.0.1:8088` against `https://127.0.0.1:8088` and was refused as
// cross-site. Nothing was actually cross-site.
//
// Requiring an ORIGIN env var would push that trap onto whoever deploys it, so
// the check happens here instead: same host as the page, protocol ignored.
// That is the part that carries the security: a foreign page cannot forge
// `Origin`, while http-vs-https is the reverse proxy's business and not a
// cross-site signal.

import { error, type Handle } from '@sveltejs/kit';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
	if (MUTATING.has(event.request.method)) {
		const origin = event.request.headers.get('origin');
		// Browsers always send `Origin` on these methods, so an absent one is a
		// curl or a script: something that could talk to the API directly
		// anyway, and that no foreign page controls.
		if (origin) {
			let from = '';
			try {
				from = new URL(origin).host;
			} catch {
				from = '';
			}
			const here = event.request.headers.get('host') ?? event.url.host;
			if (!from || from !== here) {
				error(403, `cross-site ${event.request.method} refused: ${origin} is not ${here}`);
			}
		}
	}
	return resolve(event);
};
