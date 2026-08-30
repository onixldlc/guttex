// Small IndexedDB key/value store for things that are expensive to derive and
// cheap to keep -- today that is the call graph, which costs one full walk of
// the function list per binary.
//
// There is no guttex backend yet, so the browser is the only place a computed
// artefact can live. Everything here fails soft: private-mode browsers and SSR
// have no IndexedDB, and a graph that cannot be cached is only slower, never
// broken.

const DB = 'guttex';
const STORE = 'graphs';

function open(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') return resolve(null);
		let req: IDBOpenDBRequest;
		try {
			req = indexedDB.open(DB, 1);
		} catch {
			return resolve(null);
		}
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve(null);
		req.onblocked = () => resolve(null);
	});
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
	return open().then(
		(db) =>
			new Promise<T | undefined>((resolve) => {
				if (!db) return resolve(undefined);
				let req: IDBRequest;
				try {
					req = fn(db.transaction(STORE, mode).objectStore(STORE));
				} catch {
					db.close();
					return resolve(undefined);
				}
				req.onsuccess = () => {
					resolve(req.result as T);
					db.close();
				};
				req.onerror = () => {
					resolve(undefined);
					db.close();
				};
			})
	);
}

export const cache = {
	get: <T>(key: string) => run<T>('readonly', (s) => s.get(key)),
	put: (key: string, value: unknown) => run<void>('readwrite', (s) => s.put(value, key)),
	del: (key: string) => run<void>('readwrite', (s) => s.delete(key)),
	keys: () => run<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => k ?? [])
};
