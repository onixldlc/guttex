// Everything under /api that guttex does not own itself is ghidra-rest.
//
// SvelteKit matches static segments before rest parameters, so the routes under
// /api/guttex/v1 win over this one and never reach the analyser -- which is
// stateless on purpose and has no business holding anyone's renames.

import type { RequestHandler } from './$types';
import { UPSTREAM, authorize } from '$lib/server/upstream';

// Set by the proxy hop, not by the origin. Forwarding them describes the wrong
// connection -- and undici has already decoded the body, so a content-encoding
// copied from upstream would be a lie.
const DROP = new Set([
	'content-encoding',
	'content-length',
	'transfer-encoding',
	'connection',
	'keep-alive'
]);

const proxy: RequestHandler = async ({ params, request, url }) => {
	const target = `${UPSTREAM}/${params.path}${url.search}`;

	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.delete('origin');
	headers.delete('accept-encoding');
	authorize(headers);

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

	let res: Response;
	try {
		res = await fetch(target, {
			method: request.method,
			headers,
			body: hasBody ? request.body : undefined,
			// Node streams a request body only when told the halves are
			// independent; without this an upload throws before it starts.
			...(hasBody ? { duplex: 'half' } : {}),
			redirect: 'manual'
		} as RequestInit);
	} catch (e) {
		return new Response(
			JSON.stringify({ error: `ghidra-rest unreachable: ${(e as Error).message}`, status: 502 }),
			{ status: 502, headers: { 'content-type': 'application/json' } }
		);
	}

	const out = new Headers();
	res.headers.forEach((v, k) => {
		if (!DROP.has(k.toLowerCase())) out.set(k, v);
	});
	return new Response(res.body, { status: res.status, headers: out });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
