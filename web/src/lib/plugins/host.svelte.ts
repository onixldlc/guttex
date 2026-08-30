// Plugin registry: install by URL, activate, expose contributions to the UI.
//
// A plugin is an ES module imported at run time. Nothing is bundled, nothing is
// shipped enabled -- guttex on its own talks to ghidra-rest and nothing else.

import { api } from '$lib/api/client';
import { normAddr } from '$lib/format';
import { session } from '$lib/state/session.svelte';
import type {
	ActionSpec,
	Disposer,
	GuttexPlugin,
	PanelSpec,
	PluginContext,
	PluginHost,
	PluginManifest,
	ReadApi,
	Settings
} from './types';

const STORE_KEY = 'guttex.plugins';
const SETTINGS_PREFIX = 'guttex.plugin.';

export type PluginStatus = 'idle' | 'loading' | 'active' | 'error';

export interface Installed {
	/** module URL; also the identity of the install entry */
	url: string;
	enabled: boolean;
	status: PluginStatus;
	error: string;
	manifest: PluginManifest | null;
	panels: PanelSpec[];
	actions: ActionSpec[];
	dispose: Disposer | null;
}

/** what gets persisted -- code is never cached, only the URL */
type Saved = { url: string; enabled: boolean };

export interface Notice {
	id: number;
	from: string;
	message: string;
	level: 'info' | 'warn' | 'error';
}

function ls(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null; // storage disabled in this context
	}
}

function settingsFor(pluginId: string): Settings {
	const key = SETTINGS_PREFIX + pluginId + '.settings';
	const read = (): Record<string, unknown> => {
		const s = ls();
		if (!s) return {};
		try {
			return JSON.parse(s.getItem(key) ?? '{}') as Record<string, unknown>;
		} catch {
			return {};
		}
	};
	const write = (v: Record<string, unknown>) => ls()?.setItem(key, JSON.stringify(v));
	return {
		get<T>(k: string, fallback?: T): T {
			const v = read()[k];
			return (v === undefined ? fallback : v) as T;
		},
		set(k: string, value: unknown) {
			const v = read();
			v[k] = value;
			write(v);
		},
		delete(k: string) {
			const v = read();
			delete v[k];
			write(v);
		},
		all: read
	};
}

/** ghidra-rest reads, bound to one job. No write verbs are exposed. */
function readApi(id: string): ReadApi {
	return {
		summary: () => api.summary(id),
		functions: (p) => api.functions(id, p),
		strings: (p) => api.strings(id, p),
		symbols: (p) => api.symbols(id, p),
		imports: (p) => api.imports(id, p),
		exports: (p) => api.exports(id, p),
		types: (p) => api.types(id, p),
		memory: () => api.memory(id),
		fn: (addr) => api.fn(id, normAddr(addr)),
		decompile: (addr) => api.decompile(id, normAddr(addr)),
		disasm: (addr) => api.disasm(id, normAddr(addr)),
		disasmIndex: (p) => api.disasmIndex(id, p),
		decompiledIndex: (p) => api.decompiledIndex(id, p),
		xrefs: (addr) => api.xrefs(id, normAddr(addr)),
		hexdump: (addr, length) => api.hexdump(id, normAddr(addr), length),
		log: (tail) => api.jobLog(id, tail)
	};
}

class Plugins {
	list = $state<Installed[]>([]);
	notices = $state<Notice[]>([]);

	private started = false;
	private seq = 0;
	private selectSubs = new Set<(a: string) => void>();

	/** `plugin:<pluginId>/<panelId>` -- the id a centre tab is addressed by */
	static tabId(pluginId: string, panelId: string) {
		return `plugin:${pluginId}/${panelId}`;
	}

	get panels(): { key: string; label: string; plugin: Installed; spec: PanelSpec }[] {
		return this.list
			.filter((p) => p.enabled && p.status === 'active' && p.manifest)
			.flatMap((p) =>
				p.panels.map((spec) => ({
					key: Plugins.tabId(p.manifest!.id, spec.id),
					label: spec.label,
					plugin: p,
					spec
				}))
			);
	}

	get actions(): { key: string; label: string; plugin: Installed; spec: ActionSpec }[] {
		return this.list
			.filter((p) => p.enabled && p.status === 'active' && p.manifest)
			.flatMap((p) =>
				p.actions.map((spec) => ({
					key: `${p.manifest!.id}/${spec.id}`,
					label: spec.label,
					plugin: p,
					spec
				}))
			);
	}

	/** load the install list and activate whatever is enabled; idempotent */
	init() {
		if (this.started) return;
		this.started = true;

		const s = ls();
		let saved: Saved[] = [];
		try {
			saved = JSON.parse(s?.getItem(STORE_KEY) ?? '[]') as Saved[];
		} catch {
			saved = [];
		}
		this.list = saved.map((v) => ({
			url: v.url,
			enabled: !!v.enabled,
			status: 'idle',
			error: '',
			manifest: null,
			panels: [],
			actions: [],
			dispose: null
		}));

		// Selection changes are pushed to plugins rather than polled.
		$effect.root(() => {
			$effect(() => {
				const a = session.addr;
				for (const cb of this.selectSubs) {
					try {
						cb(a);
					} catch (e) {
						console.error('[guttex] plugin onSelect threw', e);
					}
				}
			});
		});

		for (const p of this.list) if (p.enabled) this.activate(p);
	}

	private save() {
		ls()?.setItem(
			STORE_KEY,
			JSON.stringify(this.list.map((p) => ({ url: p.url, enabled: p.enabled }) satisfies Saved))
		);
	}

	async add(url: string) {
		const u = url.trim();
		if (!u) return;
		if (this.list.some((p) => p.url === u)) {
			this.notify('guttex', 'that plugin URL is already installed', 'warn');
			return;
		}
		const entry: Installed = {
			url: u,
			enabled: true,
			status: 'idle',
			error: '',
			manifest: null,
			panels: [],
			actions: [],
			dispose: null
		};
		this.list = [...this.list, entry];
		this.save();
		await this.activate(entry);
	}

	remove(url: string) {
		const p = this.list.find((x) => x.url === url);
		if (p) this.deactivate(p);
		this.list = this.list.filter((x) => x.url !== url);
		this.save();
	}

	async setEnabled(url: string, on: boolean) {
		const p = this.list.find((x) => x.url === url);
		if (!p) return;
		p.enabled = on;
		this.save();
		if (on) await this.activate(p);
		else this.deactivate(p);
	}

	async reload(url: string) {
		const p = this.list.find((x) => x.url === url);
		if (!p) return;
		this.deactivate(p);
		await this.activate(p);
	}

	private deactivate(p: Installed) {
		try {
			p.dispose?.();
		} catch (e) {
			console.error('[guttex] plugin dispose threw', e);
		}
		p.dispose = null;
		p.panels = [];
		p.actions = [];
		p.status = 'idle';
		p.error = '';
	}

	private async activate(p: Installed) {
		p.status = 'loading';
		p.error = '';
		try {
			// Cache-buster so `reload` actually re-fetches: ES module URLs are
			// interned for the lifetime of the realm.
			const sep = p.url.includes('?') ? '&' : '?';
			const mod = (await import(/* @vite-ignore */ `${p.url}${sep}v=${Date.now()}`)) as {
				default?: GuttexPlugin;
			};
			const plugin = mod.default;
			if (!plugin?.manifest?.id) {
				throw new Error('module has no default export with a manifest.id');
			}
			if (
				this.list.some(
					(x) => x !== p && x.status === 'active' && x.manifest?.id === plugin.manifest.id
				)
			) {
				throw new Error(`plugin id "${plugin.manifest.id}" is already active`);
			}

			const panels: PanelSpec[] = [];
			const actions: ActionSpec[] = [];
			const name = plugin.manifest.name || plugin.manifest.id;
			const host: PluginHost = {
				addPanel: (panel) => panels.push(panel),
				addAction: (action) => actions.push(action),
				settings: settingsFor(plugin.manifest.id),
				log: (...args) => console.log(`[${plugin.manifest.id}]`, ...args)
			};

			const dispose = await plugin.activate?.(host);

			p.manifest = plugin.manifest;
			p.panels = panels;
			p.actions = actions;
			p.dispose = typeof dispose === 'function' ? dispose : null;
			p.status = 'active';
			if (panels.length === 0 && actions.length === 0) {
				this.notify(name, 'loaded but contributed no panels or actions', 'warn');
			}
		} catch (e) {
			p.status = 'error';
			p.error = e instanceof Error ? e.message : String(e);
			p.panels = [];
			p.actions = [];
		}
	}

	/** context handed to a panel or action of the given plugin */
	context(pluginId: string): PluginContext {
		const subs = this.selectSubs;
		const notify = this.notify.bind(this);
		return {
			get jobId() {
				return session.id;
			},
			get job() {
				return session.job;
			},
			get summary() {
				return session.summary;
			},
			get addr() {
				return session.addr;
			},
			get fn() {
				return session.fn;
			},
			read: readApi(session.id),
			select: (addr: string) => void session.select(addr),
			notify: (message, level = 'info') => notify(pluginId, message, level),
			settings: settingsFor(pluginId),
			onSelect(cb) {
				subs.add(cb);
				return () => subs.delete(cb);
			}
		};
	}

	async run(key: string) {
		const a = this.actions.find((x) => x.key === key);
		if (!a?.plugin.manifest) return;
		try {
			await a.spec.run(this.context(a.plugin.manifest.id));
		} catch (e) {
			this.notify(a.plugin.manifest.id, e instanceof Error ? e.message : String(e), 'error');
		}
	}

	notify(from: string, message: string, level: Notice['level'] = 'info') {
		const id = ++this.seq;
		this.notices = [...this.notices, { id, from, message, level }];
		setTimeout(() => this.dismiss(id), level === 'error' ? 12000 : 6000);
	}

	dismiss(id: number) {
		this.notices = this.notices.filter((n) => n.id !== id);
	}
}

export const plugins = new Plugins();
