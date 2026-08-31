import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { list } from '$lib/server/store';

export const GET: RequestHandler = async () => {
	const items = await list();
	return json({ count: items.length, items });
};
