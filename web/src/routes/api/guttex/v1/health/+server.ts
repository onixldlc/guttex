import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ROOT } from '$lib/server/store';
import { UPSTREAM } from '$lib/server/upstream';

export const GET: RequestHandler = async () =>
	json({ status: 'ok', service: 'guttex', projects: ROOT, upstream: UPSTREAM });
