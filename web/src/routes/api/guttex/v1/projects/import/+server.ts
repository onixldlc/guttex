// Take back a bundle written by .../export.
//
// The project id is the binary's sha256, so an import lands where the same
// binary would land if you analysed it here: open that binary on this machine
// and your names are already on it. Nothing has to be matched up by hand.
//
// It merges rather than replaces, by the same per-entry rule as a sync push --
// an import is just a very late device reporting what it knows.
//
// The bundle arrives as the raw request body, not as a multipart form: a `File`
// sent as the body carries the zip's own content type, which a browser cannot
// send cross-origin without a preflight that guttex never answers, and there is
// no form to parse on this end. Cross-site protection does not rest on that
// shape -- `hooks.server.ts` checks the origin of every mutating request,
// whatever its content type.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { merge, putArchive, touch, validId, type Annotations, type Meta } from '$lib/server/store';
import { unzip } from '$lib/server/bundle';
import { Buffer } from 'node:buffer';

export const POST: RequestHandler = async ({ request }) => {
	const body = Buffer.from(await request.arrayBuffer());
	if (!body.length) error(400, 'empty upload');

	const parts = unzip(body);
	const metaRaw = parts.get('meta.json');
	const annRaw = parts.get('annotations.json');
	if (!metaRaw && !annRaw) error(400, 'not a guttex project bundle');

	let m: Partial<Meta> = {};
	let a: Partial<Annotations> = {};
	try {
		if (metaRaw) m = JSON.parse(metaRaw.toString('utf8'));
		if (annRaw) a = JSON.parse(annRaw.toString('utf8'));
	} catch (e) {
		error(400, `bundle is corrupt: ${(e as Error).message}`);
	}

	const id = String(m.id ?? a.job ?? '').toLowerCase();
	if (!validId(id)) error(400, 'the bundle names no usable project id');

	await touch(id, m.name ?? '', m.file ?? '');
	const doc = await merge(id, a);

	const artifacts = parts.get('ghidra-export.zip');
	if (artifacts) await putArchive(id, artifacts);

	return json({
		id,
		name: m.name ?? '',
		file: m.file ?? '',
		// the job the bundle came from -- on this machine it may mean nothing,
		// which is what the caller checks before trying to open it
		job: m.job ?? '',
		rev: doc.rev,
		renames: Object.values({ ...doc.symbols, ...doc.locals }).filter((e) => e.to !== '').length,
		archived: !!artifacts
	});
};
