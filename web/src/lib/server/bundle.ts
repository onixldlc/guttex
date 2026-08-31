// A project as one file.
//
// The bundle is a plain zip of the project folder -- `meta.json`,
// `annotations.json`, and the archived artifact set -- so it is exactly the
// thing on disk, and `unzip -l` explains it without guttex.
//
// Written by hand rather than with a library. Every entry is *stored*, not
// deflated: the artifact set is already a zip and the two JSON files are a few
// kB, so compressing would cost CPU on a big file to save nothing. Store-only
// means the writer is a few headers and the reader is a walk over them, which
// is less code than a dependency and has no supply chain.
//
// No zip64: an entry at or past 4 GiB is refused rather than written wrong.

import { crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const MAX = 0xffffffff;

export type Part = { name: string; data: Buffer };

function dosTime(d = new Date()): { time: number; date: number } {
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

/** one zip holding every part, in order */
export function zip(parts: Part[]): Uint8Array<ArrayBuffer> {
	const { time, date } = dosTime();
	const chunks: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const p of parts) {
		if (p.data.length > MAX) {
			throw new Error(`${p.name} is too large for a zip without zip64`);
		}
		const name = Buffer.from(p.name, 'utf8');
		const sum = crc32(p.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(0, 8); // method: stored
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(sum, 14);
		local.writeUInt32LE(p.data.length, 18);
		local.writeUInt32LE(p.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);

		chunks.push(local, name, p.data);

		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(CENTRAL, 0);
		cen.writeUInt16LE(20, 4); // version made by
		cen.writeUInt16LE(20, 6); // version needed
		cen.writeUInt16LE(0, 8);
		cen.writeUInt16LE(0, 10);
		cen.writeUInt16LE(time, 12);
		cen.writeUInt16LE(date, 14);
		cen.writeUInt32LE(sum, 16);
		cen.writeUInt32LE(p.data.length, 20);
		cen.writeUInt32LE(p.data.length, 24);
		cen.writeUInt16LE(name.length, 28);
		cen.writeUInt16LE(0, 30); // extra
		cen.writeUInt16LE(0, 32); // comment
		cen.writeUInt16LE(0, 34); // disk
		cen.writeUInt16LE(0, 36); // internal attrs
		// >>> 0 because JS shifts are signed: 0o100644 << 16 is negative, and
	// writeUInt32LE refuses it
	cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: a regular file
		cen.writeUInt32LE(offset, 42);
		central.push(cen, name);

		offset += local.length + name.length + p.data.length;
	}

	const dir = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(EOCD, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(parts.length, 8);
	end.writeUInt16LE(parts.length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);

	const out = Buffer.concat([...chunks, dir, end]);
	// a Buffer is a Uint8Array at runtime, but only the plain view is a BodyInit
	return new Uint8Array(out.buffer as ArrayBuffer, out.byteOffset, out.byteLength);
}

/**
 * Every entry, by name.
 *
 * Walks the local headers rather than the central directory: guttex wrote this
 * file, so there is no need to tolerate a zip whose two indexes disagree -- and
 * a walk cannot be pointed at an offset outside the buffer by a crafted
 * directory. Compressed entries are skipped; guttex never writes one, and
 * silently mis-reading someone else's zip is worse than ignoring it.
 */
export function unzip(buf: Buffer): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	let at = 0;
	while (at + 30 <= buf.length && buf.readUInt32LE(at) === LOCAL) {
		const flags = buf.readUInt16LE(at + 6);
		const method = buf.readUInt16LE(at + 8);
		const size = buf.readUInt32LE(at + 18);
		const nameLen = buf.readUInt16LE(at + 26);
		const extraLen = buf.readUInt16LE(at + 28);
		const nameAt = at + 30;
		const dataAt = nameAt + nameLen + extraLen;
		if (dataAt + size > buf.length) break;

		// bit 3 means the sizes live after the data, which a stored entry
		// written here never does
		if (method === 0 && !(flags & 0x08)) {
			const name = buf.subarray(nameAt, nameAt + nameLen).toString('utf8');
			// Entry names are attacker-controlled. Only a bare filename is ever
			// kept -- no directories, nothing that could climb out of a folder.
			if (name && !name.includes('/') && !name.includes('\\') && name !== '..') {
				out.set(name, buf.subarray(dataAt, dataAt + size));
			}
		}
		at = dataAt + size;
	}
	return out;
}
