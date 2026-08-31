import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { annotations, merge, validId, type Annotations } from '$lib/server/store';

function id(params: { id: string }): string {
	if (!validId(params.id)) error(400, 'bad project id');
	return params.id.toLowerCase();
}

export const GET: RequestHandler = async ({ params, request }) => {
	const doc = await annotations(id(params));
	// Cheap poll: a client that already has this revision gets 304 and no body.
	const tag = `"${doc.rev}"`;
	if (request.headers.get('if-none-match') === tag) {
		return new Response(null, { status: 304, headers: { etag: tag } });
	}
	return json(doc, { headers: { etag: tag } });
};

/**
 * Fold a client's document into the stored one. The response is the merged
 * document, so the pusher immediately has whatever the other device wrote --
 * one round trip is both push and pull.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	let patch: Partial<Annotations>;
	try {
		patch = await request.json();
	} catch (e) {
		error(400, `bad json: ${(e as Error).message}`);
	}
	const doc = await merge(id(params), patch);
	return json(doc, { headers: { etag: `"${doc.rev}"` } });
};
