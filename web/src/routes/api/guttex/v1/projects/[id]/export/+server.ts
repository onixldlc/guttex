// The project as one file: names, metadata, and Ghidra's artifacts together.
//
// One button, because two was one too many -- exporting the names without the
// artifacts, or archiving the artifacts without the names, both produce
// something you then have to pair up by hand on the other machine.
//
// If the artifacts have not been pulled into the project yet, they are pulled
// now, on the way out. That is what the old Archive button did; it did not need
// to be a button.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { annotations, meta, readArchive, saveArchive, validId } from '$lib/server/store';
import { UPSTREAM, authorize } from '$lib/server/upstream';
import { zip, type Part } from '$lib/server/bundle';
import { Buffer } from 'node:buffer';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!validId(params.id)) error(400, 'bad project id');
	const id = params.id.toLowerCase();

	const m = await meta(id).catch(() => null);
	if (!m) error(404, 'no such project');

	const a = await annotations(id);

	// `job` says which job to pull artifacts from; it is this machine's handle
	// on the binary and may be absent on a project that was itself imported.
	const job = url.searchParams.get('job') || m.job || '';
	let artifacts = await readArchive(id);
	if (!artifacts && job) {
		try {
			const res = await fetch(`${UPSTREAM}/v1/jobs/${job}/export`, {
				headers: authorize(new Headers())
			});
			if (res.ok && res.body) {
				await saveArchive(id, res.body);
				artifacts = await readArchive(id);
			}
		} catch {
			// An unreachable analyser is not a reason to refuse the export: the
			// names are the irreplaceable half and they are already in hand.
		}
	}

	const parts: Part[] = [
		{ name: 'meta.json', data: Buffer.from(JSON.stringify({ ...m, job }, null, 2) + '\n') },
		{ name: 'annotations.json', data: Buffer.from(JSON.stringify(a, null, 2) + '\n') }
	];
	if (artifacts) parts.push({ name: 'ghidra-export.zip', data: artifacts });

	const name = (m.file || m.name || id).replace(/[^\w.-]+/g, '_');
	const body = zip(parts);
	// The size is known here, and saying it is what lets the browser -- and
	// guttex's own export dialog -- show a real progress bar instead of a
	// spinner. Without it adapter-node answers chunked and the size is a
	// mystery until the last byte.
	return new Response(body, {
		headers: {
			'content-type': 'application/zip',
			'content-length': String(body.byteLength),
			'content-disposition': `attachment; filename="guttex-${name}.zip"`
		}
	});
};
