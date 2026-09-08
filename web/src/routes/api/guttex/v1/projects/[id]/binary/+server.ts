// The binary back out -- as submitted, or with the project's patches applied.
//
// The original on disk is never touched. `variant=original` streams the bytes
// ghidra-rest kept from the upload; `variant=patched` takes those same bytes,
// applies a patch list in memory, and sends the result. Patching happens here,
// at export time, because that is the one moment both halves are in hand: the
// immutable original and the patch document.
//
// `base` is Ghidra's image base for this program (the client has it in the
// summary). Patch addresses are Ghidra addresses; the base is what turns them
// back into file offsets -- see `$lib/server/patchmap`.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { annotations, livePatches, meta, validId } from '$lib/server/store';
import { UPSTREAM, authorize } from '$lib/server/upstream';
import { BadPatch, Unmapped, applyPatches } from '$lib/server/patchmap';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!validId(params.id)) error(400, 'bad project id');
	const id = params.id.toLowerCase();

	const m = await meta(id).catch(() => null);
	if (!m) error(404, 'no such project');

	const job = url.searchParams.get('job') || m.job || '';
	if (!/^[0-9a-f]{4,64}$/i.test(job)) error(400, 'no job to fetch the binary from');

	const variant = url.searchParams.get('variant') || 'original';
	if (variant !== 'original' && variant !== 'patched')
		error(400, 'variant must be original or patched');

	const up = await fetch(`${UPSTREAM}/v1/jobs/${job}/input`, {
		headers: authorize(new Headers())
	}).catch(() => null);
	if (!up || !up.ok || !up.body) error(502, 'the analyser no longer has the submitted file');

	const rawName = m.file || m.name || id;
	const clean = (s: string) => s.replace(/[^\w.-]+/g, '_');
	// which binary this is, said in the filename: name-original.exe / name-current.exe
	const suffixed = (name: string, tag: string) => {
		const dot = name.lastIndexOf('.');
		return dot > 0 ? `${name.slice(0, dot)}-${tag}${name.slice(dot)}` : `${name}-${tag}`;
	};

	if (variant === 'original') {
		// straight through: same bytes, same length, no buffering
		const headers = new Headers({
			'content-type': 'application/octet-stream',
			'content-disposition': `attachment; filename="${clean(suffixed(rawName, 'original'))}"`
		});
		const len = up.headers.get('content-length');
		if (len) headers.set('content-length', len);
		return new Response(up.body, { headers });
	}

	const file = new Uint8Array(await up.arrayBuffer());
	const patches = livePatches(await annotations(id));
	if (!patches.length) error(409, 'nothing to patch here; export the original instead');

	const baseParam = url.searchParams.get('base') || '';
	if (baseParam && !/^(0x)?[0-9a-fA-F]{1,16}$/.test(baseParam)) error(400, 'bad base');
	const base = baseParam ? BigInt(`0x${baseParam.replace(/^0x/i, '')}`) : null;

	try {
		applyPatches(file, base, patches);
	} catch (e) {
		if (e instanceof Unmapped || e instanceof BadPatch) error(422, e.message);
		throw e;
	}

	const tag = 'current';
	return new Response(file, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(file.length),
			'content-disposition': `attachment; filename="${clean(suffixed(rawName, tag))}"`,
			'x-guttex-patches': String(patches.length)
		}
	});
};
