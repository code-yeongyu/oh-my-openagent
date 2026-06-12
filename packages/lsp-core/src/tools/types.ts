import type {
	Diagnostic,
	DocumentSymbol,
	Location,
	LocationLink,
	PrepareRenameDefaultBehavior,
	PrepareRenameResult,
	Range,
	SeverityFilter,
	SymbolInfo,
	WorkspaceEdit,
} from "../lsp/types.js";
import type { ApplyResult } from "../lsp/workspace-edit.js";

export interface TextContent {
	type: "text";
	text: string;
}

export interface ToolExecutionResult {
	content: TextContent[];
	isError?: boolean;
	details?: unknown;
}

export interface JsonSchema {
	type: string;
	description?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	enum?: string[];
}

export interface LspMcpTool {
	name: string;
	aliases?: string[];
	title: string;
	description: string;
	inputSchema: JsonSchema;
	execute(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult>;
}

export interface LspDiagnosticsDetails {
	filePath: string;
	severity: SeverityFilter;
	mode: "file" | "directory";
	diagnostics: Array<{ file: string; diagnostic: Diagnostic }>;
	totalDiagnostics: number;
	truncated: boolean;
	error?: string;
	errorKind?: "missing_dependency" | "no_files" | "invalid_path";
}

export interface LspGotoDefinitionDetails {
	filePath: string;
	line: number;
	character: number;
	locations: Array<Location | LocationLink>;
	error?: string;
	errorKind?: "missing_dependency";
}

export interface LspFindReferencesDetails {
	filePath: string;
	line: number;
	character: number;
	references: Location[];
	totalReferences: number;
	truncated: boolean;
	error?: string;
	errorKind?: "missing_dependency";
}

export interface LspSymbolsDetails {
	filePath: string;
	scope: "document" | "workspace";
	query?: string;
	symbols: Array<DocumentSymbol | SymbolInfo>;
	totalSymbols: number;
	truncated: boolean;
	error?: string;
	errorKind?: "missing_dependency" | "missing_query";
}

export interface LspPrepareRenameDetails {
	filePath: string;
	line: number;
	character: number;
	result: PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null;
	error?: string;
	errorKind?: "missing_dependency";
}

export interface LspRenameDetails {
	filePath: string;
	line: number;
	character: number;
	newName: string;
	apply: ApplyResult | null;
	edit: WorkspaceEdit | null;
	error?: string;
	errorKind?: "missing_dependency";
}
