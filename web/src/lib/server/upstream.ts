// Where ghidra-rest is, and the credential for it.
//
// This is the reason the browser has a same-origin API at all: the token cannot
// live in a bundle anyone can read, and ghidra-rest has no CORS layer to widen.
// Importing from `$lib/server` makes that structural -- SvelteKit will not let
// client code reach this file.

import { env } from '$env/dynamic/private';

export const UPSTREAM = (env.GHIDRAREST_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
export const TOKEN = env.GHIDRAREST_TOKEN || '';

export function authorize(headers: Headers): Headers {
	// Whatever the caller sent is dropped: the token is the server's, not the
	// browser's, and an Authorization header arriving from outside is noise.
	headers.delete('authorization');
	if (TOKEN) headers.set('authorization', `Bearer ${TOKEN}`);
	return headers;
}
