import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NotFound, meta, remove, touch, validId } from '$lib/server/store';

function id(params: { id: string }): string {
	if (!validId(params.id)) error(400, 'bad project id');
	return params.id.toLowerCase();
}

export const GET: RequestHandler = async ({ params }) => {
	try {
		return json(await meta(id(params)));
	} catch (e) {
		if (e instanceof NotFound) error(404, 'no such project');
		throw e;
	}
};

/** create on first open, and carry the binary's name across */
export const PUT: RequestHandler = async ({ params, request }) => {
	let body: { name?: string; file?: string; job?: string } = {};
	try {
		body = await request.json();
	} catch {
		/* an empty body is a plain touch */
	}
	// The job id is this machine's handle on the binary. Recording it is what
	// lets an export pull the artifacts without being told where they are.
	return json(await touch(id(params), body.name ?? '', body.file ?? '', body.job ?? ''));
};

export const DELETE: RequestHandler = async ({ params }) => {
	await remove(id(params));
	return new Response(null, { status: 204 });
};
