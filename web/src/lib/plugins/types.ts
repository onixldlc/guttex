// The plugin contract.
//
// Deliberately framework-free: a plugin gets a DOM node and a plain context
// object, never a Svelte component or store. That keeps the surface stable if
// the UI is rewritten, and means a plugin is just an ES module -- no build step,
// no dependency on guttex's package.json.
//
// Everything guttex itself ships (disassembly, decompiler, hexdump, info) is
// built in. Plugins are for what guttex deliberately does not ship: AI
// assistance, custom exporters, signature matching, personal workflows.

import type {
	Decompiled,
	DecompiledIndexEntry,
	DisasmIndexEntry,
	DisasmListing,
	ExportEntry,
	FunctionEntry,
	HexdumpResponse,
	Import,
	Job,
	MemBlock,
	Page,
	PageQuery,
	StringEntry,
	Summary,
	Symbol as SymbolEntry,
	TypeEntry,
	XrefsResponse
} from '$lib/api/types';

export type Disposer = () => void;

export interface PluginManifest {
	/** stable, unique, url-safe; namespaces the plugin's tabs and settings */
	id: string;
	name: string;
	version?: string;
	description?: string;
	author?: string;
	homepage?: string;
}

/** A tab in the centre view, alongside DISASSEMBLY / DECOMPILER / HEXDUMP. */
export interface PanelSpec {
	id: string;
	label: string;
	/**
	 * Called when the tab is first shown. Return a disposer to clean up; it runs
	 * when the tab is closed, the plugin is disabled, or the job changes.
	 */
	mount: (el: HTMLElement, ctx: PluginContext) => void | Disposer | Promise<void | Disposer>;
}

/** A command in the workbench's actions menu. */
export interface ActionSpec {
	id: string;
	label: string;
	/** 'address' actions stay disabled until something is selected */
	needs?: 'job' | 'address';
	run: (ctx: PluginContext) => unknown;
}

/**
 * Read side of ghidra-rest, bound to the open job. Plugins get no write access
 * and no direct handle on the API token: it lives in the proxy, never in the
 * page, and this keeps it that way.
 */
export interface ReadApi {
	summary(): Promise<Summary>;
	functions(p?: PageQuery): Promise<Page<FunctionEntry>>;
	strings(p?: PageQuery): Promise<Page<StringEntry>>;
	symbols(p?: PageQuery): Promise<Page<SymbolEntry>>;
	imports(p?: PageQuery): Promise<Page<Import>>;
	exports(p?: PageQuery): Promise<Page<ExportEntry>>;
	types(p?: PageQuery): Promise<Page<TypeEntry>>;
	memory(): Promise<MemBlock[]>;
	fn(addr: string): Promise<FunctionEntry>;
	decompile(addr: string): Promise<Decompiled>;
	disasm(addr: string): Promise<DisasmListing>;
	disasmIndex(p?: PageQuery): Promise<Page<DisasmIndexEntry>>;
	decompiledIndex(p?: PageQuery): Promise<Page<DecompiledIndexEntry>>;
	xrefs(addr: string): Promise<XrefsResponse>;
	hexdump(addr: string, length?: number): Promise<HexdumpResponse>;
	log(tail?: number): Promise<string>;
}

/** Per-plugin persistence. JSON only; backed by localStorage. */
export interface Settings {
	get<T = unknown>(key: string): T | undefined;
	get<T = unknown>(key: string, fallback: T): T;
	set(key: string, value: unknown): void;
	delete(key: string): void;
	all(): Record<string, unknown>;
}

/** What a panel or action is handed at run time. Reads are live. */
export interface PluginContext {
	readonly jobId: string;
	readonly job: Job | null;
	readonly summary: Summary | null;
	/** normalised address currently selected, '' if none */
	readonly addr: string;
	/** the selected function, when the address is one */
	readonly fn: FunctionEntry | null;
	read: ReadApi;
	/** navigate the workbench; also pushes browser history */
	select(addr: string): void;
	notify(message: string, level?: 'info' | 'warn' | 'error'): void;
	settings: Settings;
	/** fires on every selection change; returns an unsubscribe */
	onSelect(cb: (addr: string) => void): Disposer;
}

/** Handed to `activate()`. Register everything here, synchronously. */
export interface PluginHost {
	addPanel(panel: PanelSpec): void;
	addAction(action: ActionSpec): void;
	settings: Settings;
	log(...args: unknown[]): void;
}

/** The module's default export. */
export interface GuttexPlugin {
	manifest: PluginManifest;
	activate?: (host: PluginHost) => void | Disposer | Promise<void | Disposer>;
}
