// Mirrors ghidra-rest docs/openapi.yaml. Field names are copied from the real
// artifact set, not guessed -- keep them in sync when that spec moves.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface JobOptions {
	decompile?: boolean;
	decompile_max_funcs?: number;
	decompile_timeout_sec?: number;
	analysis_timeout_sec?: number;
	processor?: string;
	compiler_spec?: string;
	loader?: string;
}

export interface Job {
	id: string;
	filename: string;
	size: number;
	sha256: string;
	status: JobStatus;
	error?: string;
	options?: JobOptions;
	created_at: string;
	started_at?: string;
	finished_at?: string;
	duration_ms?: number;
	ghidra_version?: string;
	language?: string;
	executable_format?: string;
	counts?: Record<string, number>;
}

export interface SubmitResponse {
	job: Job;
	deduplicated?: boolean;
}

export interface Page<T> {
	total: number;
	count: number;
	limit: number;
	offset: number;
	query?: string;
	items: T[];
}

/** query params every paged result endpoint accepts */
export interface PageQuery {
	q?: string;
	limit?: number;
	offset?: number;
}

/** /v1/jobs pages like the result lists but names the array `jobs`. */
export interface JobsPage {
	total: number;
	count: number;
	limit: number;
	offset: number;
	jobs: Job[];
}

export interface Capabilities {
	service: string;
	version: string;
	ghidra_version?: string;
	limits?: Record<string, unknown>;
	features?: string[];
	endpoints?: string[];
}

export interface Summary {
	name: string;
	executable_path?: string;
	executable_format?: string;
	md5?: string;
	sha256?: string;
	language?: string;
	processor?: string;
	endian?: 'little' | 'big';
	address_size?: number;
	compiler_spec?: string;
	image_base?: string;
	min_address?: string;
	max_address?: string;
	creation_date?: string;
	ghidra_version?: string;
	memory_bytes_exported?: number;
	counts?: Record<string, number>;
	entry_points?: string[];
}

export interface Parameter {
	name: string;
	type: string;
	ordinal: number;
}

export interface CallEdge {
	address: string;
	name: string;
}

export interface FunctionEntry {
	address: string;
	address_display?: string;
	name: string;
	namespace?: string;
	signature?: string;
	calling_convention?: string;
	return_type?: string;
	size?: number;
	parameter_count?: number;
	is_thunk?: boolean;
	is_external?: boolean;
	is_inline?: boolean;
	has_varargs?: boolean;
	no_return?: boolean;
	stack_frame_size?: number;
	parameters?: Parameter[];
	calls?: CallEdge[];
	called_by?: CallEdge[];
}

/**
 * One prototype guttex has pushed back into Ghidra. `original` is what the
 * analyser said before the first edit -- Ghidra has no cross-process undo, so
 * resetting means re-applying this string.
 */
export interface SignatureEntry {
	address: string;
	prototype: string;
	calling_convention?: string;
	original: string;
	original_calling_convention?: string;
	at?: string;
}

export interface SignaturesResponse {
	job: string;
	/** false when this job kept no Ghidra project: nothing here can be retyped */
	editable: boolean;
	count: number;
	signature: SignatureEntry[];
	/** names this program's compiler spec accepts; empty on older analyses */
	calling_conventions?: string[];
}

export interface SignatureApplied {
	job: string;
	address: string;
	ok: true;
	before: string;
	prototype: string;
	calling_convention?: string;
	original?: string;
	set_at?: string;
	function?: FunctionEntry;
	/** the retyped function plus every caller, all re-decompiled server side */
	redecompiled?: string[];
	duration_ms: number;
}

export interface Instruction {
	address: string;
	address_display?: string;
	bytes?: string;
	mnemonic: string;
	operands?: string;
	text?: string;
	comment?: string;
	length?: number;
	is_call?: boolean;
	is_jump?: boolean;
	is_terminal?: boolean;
	/** single known call/jump target, when there is exactly one */
	flow?: string;
}

export interface DisasmListing {
	address: string;
	address_display?: string;
	name: string;
	instructions: Instruction[];
	count: number;
	truncated?: boolean;
}

export interface DisasmIndexEntry {
	address: string;
	name: string;
	count: number;
}

/** one line of decompiled C and the instructions Ghidra says produced it */
export interface DecompLine {
	/** 1-based line number into `c` */
	n: number;
	/** instruction addresses, ascending */
	a: string[];
}

export interface Decompiled {
	address: string;
	address_display?: string;
	name: string;
	signature?: string;
	ok: boolean;
	error?: string;
	c?: string;
	/** absent when the analysis predates the line map */
	lines?: DecompLine[];
}

export interface DecompiledIndexEntry {
	address: string;
	name: string;
	ok: boolean;
	length: number;
}

export interface Xref {
	address: string;
	address_display?: string;
	type?: string;
	is_call?: boolean;
	is_jump?: boolean;
	is_data?: boolean;
	source?: string;
}

export interface XrefsResponse {
	address: string;
	to?: Xref[];
	from?: Xref[];
	indexed?: boolean;
}

export interface StringEntry {
	address: string;
	address_display?: string;
	value: string;
	type?: string;
	length?: number;
	reference_count?: number;
}

export interface Symbol {
	address: string;
	address_display?: string;
	name: string;
	full_name?: string;
	type?: string;
	source?: string;
	namespace?: string;
	primary?: boolean;
	global?: boolean;
	external?: boolean;
	reference_count?: number;
}

export interface Import {
	library?: string;
	name: string;
	original_name?: string;
	is_function?: boolean;
	address?: string;
	thunk_address?: string;
}

export interface ExportEntry {
	address: string;
	address_display?: string;
	name: string;
	is_function?: boolean;
}

export interface TypeField {
	name: string;
	type: string;
	offset?: number;
	size?: number;
}

export interface TypeEntry {
	name: string;
	path?: string;
	kind?: string;
	size?: number;
	base_type?: string;
	fields?: TypeField[];
	values?: Record<string, number>;
}

export interface MemBlock {
	name: string;
	start: string;
	start_display?: string;
	end?: string;
	size: number;
	read?: boolean;
	write?: boolean;
	execute?: boolean;
	volatile?: boolean;
	initialized?: boolean;
	overlay?: boolean;
	type?: string;
	source?: string;
	file?: string;
	bytes_exported?: number;
}

export interface HexdumpResponse {
	address: string;
	block?: string;
	length: number;
	base64?: string;
	hex?: string;
}
