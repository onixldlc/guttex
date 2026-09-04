// guttex's memory: one folder per project under the projects volume, holding
// what ghidra-rest refuses to.
//
//     <projects>/<sha256 of the binary>/
//         meta.json           name, timestamps, revision, last job id
//         annotations.json    renames, and whatever annotations come next
//         ghidra-export.zip   the artifact set, once archived
//
// Keyed by the binary's sha256, not by a job id. ghidra-rest mints job ids from
// crypto/rand, so the same binary analysed on two machines has two ids and a
// project keyed by one of them could never be carried to the other. The content
// hash is the same everywhere, which is what makes an exported project openable
// wherever the same binary is.
//
// A folder, not a database, because the thing the folder buys you is the whole
// point: analyse on the 32-core box, copy one directory to the laptop, keep
// working. A schema migration would buy nothing here.
//
// `$lib/server` is never bundled into the client -- SvelteKit refuses to import
// it from browser code -- so the projects path and the ghidra-rest token stay
// on the server by construction, not by discipline.

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const ROOT = env.GUTTEX_PROJECTS || '/projects';

const META = 'meta.json';
const ANN = 'annotations.json';
export const ARCHIVE = 'ghidra-export.zip';
const FORMAT = 1;

/**
 * One annotation. `at` is the editing device's clock, and it is what merges are
 * decided on.
 *
 * An empty `to` is a tombstone, not a deletion: two devices only agree about a
 * removal if the removal is a fact that can be shipped and compared like any
 * other. Dropping the key instead would let a stale device resurrect the name.
 */
export type Entry = { from?: string; to: string; at: number; by?: string };

export type Annotations = {
	version: number;
	job: string;
	rev: number;
	updated_at?: string;
	/** keyed by address */
	symbols: Record<string, Entry>;
	/** keyed by `<function entry>:<original identifier>` */
	locals: Record<string, Entry>;
	/**
	 * Byte patches, keyed by address, nothing else:
	 *
	 *     { "1040d0": { "changes": "a1 a1 a1 a1" } }
	 *
	 * means the byte at 1040d0 and the next three become a1 a1 a1 a1. The
	 * length of `changes` is the length of the patch. The binary itself is
	 * never modified -- patches are applied to a copy on export.
	 *
	 * Deliberately not an `Entry`: no timestamps, no device, no tombstones.
	 * The map is replaced wholesale by whoever pushes it.
	 */
	patches: Record<string, Patch>;
};

export type Patch = { changes: string };

export type Meta = {
	/** sha256 of the binary; the project id */
	id: string;
	name: string;
	file?: string;
	/** the job this project was last opened through, on this machine */
	job?: string;
	created_at: string;
	updated_at: string;
	rev: number;
	renames: number;
	patches?: number;
	archived?: boolean;
	archive_bytes?: number;
};

export class NotFound extends Error {}

/**
 * Keeps a request-supplied id from becoming a path. Project ids are ghidra-rest
 * job ids, which are hex; anything else is refused rather than sanitised,
 * because a sanitised path is a path someone eventually escapes.
 */
export function validId(id: string): boolean {
	return /^[0-9a-f]{4,64}$/i.test(id);
}

export const dir = (id: string) => join(ROOT, id.toLowerCase());
export const archivePath = (id: string) => join(dir(id), ARCHIVE);

const now = () => new Date().toISOString();
const blank = (job: string): Annotations => ({
	version: FORMAT,
	job,
	rev: 0,
	symbols: {},
	locals: {},
	patches: {}
});

// One writer at a time. Two people renaming things is not a write-heavy
// workload, and a chained promise is the whole of the locking this needs.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
	const run = chain.then(fn, fn);
	chain = run.catch(() => {});
	return run;
}

async function readJSON<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw e;
	}
}

/** atomic within the directory: temp file, then rename over the target */
async function writeJSON(path: string, value: unknown) {
	const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
	await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
	await rename(tmp, path);
}

// -------------------------------------------------------------------- reading

/**
 * The stored document, or an empty one for a project that has never been
 * written. A project that does not exist yet is not an error: opening a binary
 * is what creates it, and the client should not have to ask twice.
 */
export async function annotations(id: string): Promise<Annotations> {
	const a = await readJSON<Annotations>(join(dir(id), ANN));
	if (!a) return blank(id);
	return {
		...blank(id),
		...a,
		symbols: a.symbols ?? {},
		locals: a.locals ?? {},
		patches: a.patches ?? {},
		job: id
	};
}

export async function meta(id: string): Promise<Meta> {
	const m = await readJSON<Meta>(join(dir(id), META));
	if (!m) throw new NotFound('no such project');
	m.id = id;
	try {
		const s = await stat(archivePath(id));
		m.archived = true;
		m.archive_bytes = s.size;
	} catch {
		/* no archive pulled yet */
	}
	return m;
}

/** every project, most recently touched first */
export async function list(): Promise<Meta[]> {
	let entries;
	try {
		entries = await readdir(ROOT, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: Meta[] = [];
	for (const e of entries) {
		if (!e.isDirectory() || !validId(e.name)) continue;
		try {
			out.push(await meta(e.name));
		} catch {
			// a directory with no meta.json is not a project
		}
	}
	return out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

// -------------------------------------------------------------------- writing

/**
 * Creates the project on first open and carries the binary's name across, so
 * the project list reads like a list of binaries rather than a list of job ids.
 */
export function touch(id: string, name = '', file = '', job = ''): Promise<Meta> {
	return locked(async () => {
		await mkdir(dir(id), { recursive: true });
		let m = await readJSON<Meta>(join(dir(id), META));
		if (!m) m = { id, name: '', created_at: now(), updated_at: now(), rev: 0, renames: 0 };
		if (name) m.name = name;
		if (file) m.file = file;
		// The job id is this machine's handle on the binary, so it is refreshed
		// rather than carried: an imported project points at whatever job the
		// machine you opened it on has.
		if (job) m.job = job;
		if (!m.name) m.name = file || id;
		m.updated_at = now();
		await writeJSON(join(dir(id), META), m);
		return meta(id);
	});
}

/**
 * Folds a client's document into the stored one and returns the result.
 *
 * Per key, the later `at` wins. Not per document: two devices editing different
 * functions in the same binary is the normal case, and whole-file
 * last-writer-wins would quietly throw one of them away. Equal timestamps keep
 * what is stored, so a replayed push is a no-op and pollers stay quiet.
 *
 * The client sends everything it has rather than a diff. These documents are a
 * few kB of names; a diff protocol would be more code and more ways to drift.
 */
export function merge(id: string, patch: Partial<Annotations>): Promise<Annotations> {
	return locked(async () => {
		await mkdir(dir(id), { recursive: true });
		const cur = await annotations(id);

		let changed = false;
		changed = mergeInto(cur.symbols, patch.symbols) || changed;
		changed = mergeInto(cur.locals, patch.locals) || changed;
		changed = replacePatches(cur, patch.patches) || changed;
		if (!changed) return cur;

		cur.version = FORMAT;
		cur.rev++;
		cur.updated_at = now();
		await writeJSON(join(dir(id), ANN), cur);

		// keep the card in step, so the project list can sort by activity
		// without reading every annotations file
		const m = (await readJSON<Meta>(join(dir(id), META))) ?? {
			id,
			name: id,
			created_at: now(),
			updated_at: now(),
			rev: 0,
			renames: 0
		};
		m.rev = cur.rev;
		m.renames = live(cur);
		m.patches = Object.keys(cur.patches).length;
		m.updated_at = now();
		await writeJSON(join(dir(id), META), m);
		return cur;
	});
}

function mergeInto(dst: Record<string, Entry>, src?: Record<string, Entry>): boolean {
	if (!src) return false;
	let changed = false;
	for (const [k, e] of Object.entries(src)) {
		if (!e || typeof e.to !== 'string' || typeof e.at !== 'number') continue;
		const have = dst[k];
		if (have && e.at <= have.at) continue;
		dst[k] = { from: e.from, to: e.to, at: e.at, by: e.by };
		changed = true;
	}
	return changed;
}

/** live renames: tombstones are stored, but they are not names */
function live(a: Annotations): number {
	const n = (r: Record<string, Entry>) => Object.values(r).filter((e) => e.to !== '').length;
	return n(a.symbols) + n(a.locals);
}

/**
 * The pushed patch map replaces the stored one -- no per-key merge, because
 * there is nothing to merge on: a patch is an address and its bytes, full
 * stop. Removing a patch is removing the key. Absent (`undefined`) means the
 * client did not talk about patches at all and the stored map stands.
 */
function replacePatches(cur: Annotations, next?: Record<string, Patch>): boolean {
	if (!next || typeof next !== 'object') return false;
	const clean: Record<string, Patch> = {};
	for (const [k, v] of Object.entries(next)) {
		if (v && typeof v.changes === 'string' && v.changes !== '') clean[k] = { changes: v.changes };
	}
	if (JSON.stringify(clean) === JSON.stringify(cur.patches)) return false;
	cur.patches = clean;
	return true;
}

/** patches by ascending address, for applying to an export */
export function livePatches(a: Annotations): { addr: string; bytes: string }[] {
	return Object.entries(a.patches)
		.filter(([, e]) => typeof e?.changes === 'string' && e.changes !== '')
		.map(([addr, e]) => ({ addr, bytes: e.changes }))
		.sort((x, y) => (x.addr.padStart(16, '0') < y.addr.padStart(16, '0') ? -1 : 1));
}

export function remove(id: string): Promise<void> {
	return locked(async () => {
		await rm(dir(id), { recursive: true, force: true });
	});
}

/**
 * Streams ghidra-rest's artifact export into the project folder, atomically, so
 * a failed pull leaves the previous archive intact.
 *
 * This is what makes a project portable: once archived, the folder holds both
 * halves of the work -- Ghidra's JSON and yours.
 */
/** the archived artifact set, or null when nothing has been pulled yet */
export async function readArchive(id: string): Promise<Buffer | null> {
	try {
		return await readFile(archivePath(id));
	} catch {
		return null;
	}
}

/** land an artifact set that arrived inside a project bundle */
export function putArchive(id: string, bytes: Uint8Array): Promise<void> {
	return locked(async () => {
		await mkdir(dir(id), { recursive: true });
		const tmp = `${archivePath(id)}.${randomBytes(6).toString('hex')}.tmp`;
		await writeFile(tmp, bytes);
		await rename(tmp, archivePath(id));
	});
}

export function saveArchive(id: string, body: ReadableStream<Uint8Array>): Promise<number> {
	return locked(async () => {
		await mkdir(dir(id), { recursive: true });
		const tmp = `${archivePath(id)}.${randomBytes(6).toString('hex')}.tmp`;
		await pipeline(Readable.fromWeb(body as never), createWriteStream(tmp));
		await rename(tmp, archivePath(id));
		const s = await stat(archivePath(id));
		return s.size;
	});
}
