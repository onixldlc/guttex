export function fmtBytes(n: number | undefined): string {
	if (n === undefined || n === null) return '-';
	if (n < 1024) return `${n} B`;
	const u = ['KiB', 'MiB', 'GiB', 'TiB'];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export function fmtDuration(ms: number | undefined): string {
	if (!ms && ms !== 0) return '-';
	if (ms < 1000) return `${ms} ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)} s`;
	const m = Math.floor(s / 60);
	return `${m}m ${Math.round(s - m * 60)}s`;
}

export function fmtTime(iso: string | undefined): string {
	if (!iso) return '-';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { hour12: false });
}

export function relTime(iso: string | undefined): string {
	if (!iso) return '-';
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return iso;
	const d = Math.round((Date.now() - t) / 1000);
	if (d < 60) return `${d}s ago`;
	if (d < 3600) return `${Math.round(d / 60)}m ago`;
	if (d < 86400) return `${Math.round(d / 3600)}h ago`;
	return `${Math.round(d / 86400)}d ago`;
}

/** ghidra-rest normalises addresses; keep the UI's own copies identical so
    selection comparisons and URLs line up. */
export function normAddr(a: string): string {
	const s = (a ?? '').trim();
	if (!s) return '';
	if (s.includes(':')) return s; // spaced address like `external:1`
	return s.replace(/^0x/i, '').replace(/^0+(?=[0-9a-fA-F])/, '').toLowerCase();
}

export function displayAddr(a: string | undefined, pad = 8): string {
	if (!a) return '';
	if (a.includes(':')) return a;
	const s = normAddr(a);
	return '0x' + s.padStart(pad, '0');
}

export function shortId(id: string | undefined): string {
	return id ? id.slice(0, 8) : '';
}

// ---------------------------------------------------------------- C tokens

export type Tok = { t: string; c: string };

const KEYWORDS = new Set([
	'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
	'return', 'goto', 'sizeof', 'typedef', 'struct', 'union', 'enum', 'static', 'extern',
	'const', 'volatile', 'register', 'inline', 'restrict'
]);

const TYPES = new Set([
	'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
	'bool', '_Bool', 'size_t', 'ssize_t', 'ptrdiff_t',
	// Ghidra's decompiler vocabulary
	'byte', 'word', 'dword', 'qword', 'uint', 'ulong', 'ushort', 'undefined',
	'undefined1', 'undefined2', 'undefined4', 'undefined8', 'code', 'astruct'
]);

const ID = /[A-Za-z_$][A-Za-z0-9_$.]*/y;
const NUM = /(?:0[xX][0-9a-fA-F]+|\d+)[uUlL]*/y;

/** Tiny scanner -- enough for decompiler output, not a C parser. Callers render
    the tokens as spans, so nothing is ever injected as HTML. */
export function tokenizeC(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	const push = (t: string, c: string) => {
		if (t) out.push({ t, c });
	};

	while (i < src.length) {
		const ch = src[i];

		if (ch === '/' && src[i + 1] === '/') {
			const nl = src.indexOf('\n', i);
			const end = nl === -1 ? src.length : nl;
			push(src.slice(i, end), 'com');
			i = end;
			continue;
		}
		if (ch === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i + 2);
			const stop = end === -1 ? src.length : end + 2;
			push(src.slice(i, stop), 'com');
			i = stop;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < src.length && src[j] !== ch) {
				if (src[j] === '\\') j++;
				j++;
			}
			push(src.slice(i, Math.min(j + 1, src.length)), 'str');
			i = j + 1;
			continue;
		}
		if (ch >= '0' && ch <= '9') {
			NUM.lastIndex = i;
			const m = NUM.exec(src);
			if (m) {
				push(m[0], 'num');
				i += m[0].length;
				continue;
			}
		}
		if (/[A-Za-z_$]/.test(ch)) {
			ID.lastIndex = i;
			const m = ID.exec(src);
			if (m) {
				const w = m[0];
				let k = i + w.length;
				while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
				const cls = KEYWORDS.has(w)
					? 'key'
					: TYPES.has(w)
						? 'type'
						: src[k] === '('
							? 'fn'
							: 'id';
				push(w, cls);
				i += w.length;
				continue;
			}
		}
		if (/[{}()[\];,.*&|!<>=+\-/%^~?:]/.test(ch)) {
			push(ch, 'punct');
			i++;
			continue;
		}
		// whitespace and anything unclassified
		let j = i;
		while (j < src.length && /[^A-Za-z0-9_$"'/{}()[\];,.*&|!<>=+\-%^~?:]/.test(src[j])) j++;
		push(src.slice(i, Math.max(j, i + 1)), 'plain');
		i = Math.max(j, i + 1);
	}
	return out;
}
