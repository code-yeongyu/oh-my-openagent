import { resolve } from "node:path";

import { isDirectoryPath, type WithLspClientOptions, withLspClient } from "./lsp/client-wrapper.js";
import { getMergedServers } from "./lsp/config-loader.js";
import { DEFAULT_MAX_DIAGNOSTICS, DEFAULT_MAX_REFERENCES, DEFAULT_MAX_SYMBOLS } from "./lsp/constants.js";
import { aggregateDiagnosticsForDirectory } from "./lsp/directory-diagnostics.js";
import {
	filterDiagnosticsBySeverity,
	formatApplyResult,
	formatDiagnostic,
	formatDocumentSymbol,
	formatLocation,
	formatPrepareRenameResult,
	formatSymbolInfo,
} from "./lsp/formatters.js";
import { inferExtensionFromDirectory } from "./lsp/infer-extension.js";
import { getLspManager } from "./lsp/manager.js";
import { type InstallDecision, isInstallDecision, recordInstallDecision } from "./lsp/server-install-state.js";
import { getAllServers } from "./lsp/server-resolution.js";
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
} from "./lsp/types.js";
import { type ApplyResult, applyWorkspaceEdit } from "./lsp/workspace-edit.js";
import { missingDependencyResult } from "./missing-dependency-result.js";
import { contextCwd } from "./request-context.js";

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

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
	type: "object",
	properties,
	required,
});

function text(text: string, details?: unknown, isError = false): ToolExecutionResult {
	return { content: [{ type: "text", text }], details, isError };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(params: Record<string, unknown>, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Missing required string parameter '${key}'`);
	}
	return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
	const value = params[key];
	return typeof value === "string" ? value : undefined;
}

function requireNumber(params: Record<string, unknown>, key: string): number {
	const value = params[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Missing required number parameter '${key}'`);
	}
	return value;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
	const value = params[key];
	return typeof value === "boolean" ? value : undefined;
}

function isSeverityFilter(value: unknown): value is SeverityFilter {
	return value === "error" || value === "warning" || value === "information" || value === "hint" || value === "all";
}

function severityFilter(params: Record<string, unknown>): SeverityFilter {
	const value = params["severity"];
	if (isSeverityFilter(value)) return value;
	return "all";
}

function clientOptions(signal: AbortSignal | undefined): WithLspClientOptions {
	return signal === undefined ? {} : { signal };
}

function asDiagnosticArray(result: { items?: Diagnostic[] } | Diagnostic[] | null | undefined): Diagnostic[] {
	if (!result) return [];
	if (Array.isArray(result)) return result;
	return result.items ?? [];
}

function isDocumentSymbol(symbol: DocumentSymbol | SymbolInfo): symbol is DocumentSymbol {
	return "range" in symbol;
}

async function executeLspStatus(): Promise<ToolExecutionResult> {
	const servers = getAllServers();
	const snapshots = getLspManager().getSnapshot();
	const installed = servers.filter((server) => server.installed && !server.disabled);
	const configuredLines = servers.map((server) => {
		const state = server.disabled ? "disabled" : server.installed ? "installed" : "missing";
		return `- ${server.id}: ${state}; source=${server.source}; extensions=${server.extensions.join(", ")}`;
	});
	const activeLines = snapshots.map((snapshot) => {
		const state = snapshot.alive ? (snapshot.isInitializing ? "initializing" : "alive") : "dead";
		return `- ${snapshot.serverId}: ${state}; root=${snapshot.root}; refs=${snapshot.refCount}`;
	});
	const lines = [
		`Configured LSP servers: ${servers.length}`,
		`Installed LSP servers: ${installed.length}`,
		"",
		...configuredLines,
		"",
		`Active LSP clients: ${snapshots.length}`,
		...activeLines,
	];
	return text(lines.join("\n"), { servers, snapshots });
}

export async function executeLspDiagnostics(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const severity = severityFilter(params);

	try {
		const absPath = resolve(contextCwd(), filePath);
		if (isDirectoryPath(absPath)) {
			const extension = inferExtensionFromDirectory(absPath);
			if (!extension) {
				const message = `No supported source files found in directory: ${absPath}`;
				const details: LspDiagnosticsDetails = {
					filePath,
					severity,
					mode: "directory",
					diagnostics: [],
					totalDiagnostics: 0,
					truncated: false,
					error: message,
					errorKind: "no_files",
				};
				return text(message, details);
			}

			const output = await aggregateDiagnosticsForDirectory(absPath, extension, severity);
			const details: LspDiagnosticsDetails = {
				filePath,
				severity,
				mode: "directory",
				diagnostics: [],
				totalDiagnostics: 0,
				truncated: false,
			};
			return text(output, details);
		}

		const result = await withLspClient(
			filePath,
			async (client) => client.diagnostics(filePath),
			"diagnostics",
			clientOptions(signal),
		);
		const diagnostics = filterDiagnosticsBySeverity(asDiagnosticArray(result), severity);
		const total = diagnostics.length;
		const truncated = total > DEFAULT_MAX_DIAGNOSTICS;
		const limited = truncated ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS) : diagnostics;
		const output =
			total === 0
				? "No diagnostics found"
				: [
						...(truncated ? [`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`] : []),
						...limited.map(formatDiagnostic),
					].join("\n");
		const details: LspDiagnosticsDetails = {
			filePath,
			severity,
			mode: "file",
			diagnostics: diagnostics.map((diagnostic) => ({ file: absPath, diagnostic })),
			totalDiagnostics: total,
			truncated,
		};
		return text(output, details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			severity,
			mode: "file",
			diagnostics: [],
			totalDiagnostics: 0,
			truncated: false,
		} satisfies Omit<LspDiagnosticsDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

async function executeLspGotoDefinition(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const line = requireNumber(params, "line");
	const character = requireNumber(params, "character");

	try {
		const result = await withLspClient(
			filePath,
			async (client) => client.definition(filePath, line, character),
			"definition",
			clientOptions(signal),
		);
		const locations = !result ? [] : Array.isArray(result) ? result : [result];
		const details: LspGotoDefinitionDetails = { filePath, line, character, locations };
		if (locations.length === 0) return text("No definition found", details);
		return text(locations.map(formatLocation).join("\n"), details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			line,
			character,
			locations: [],
		} satisfies Omit<LspGotoDefinitionDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

async function executeLspFindReferences(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const line = requireNumber(params, "line");
	const character = requireNumber(params, "character");
	const includeDeclaration = optionalBoolean(params, "includeDeclaration") ?? true;

	try {
		const result = await withLspClient(
			filePath,
			async (client) => client.references(filePath, line, character, includeDeclaration),
			"references",
			clientOptions(signal),
		);
		const references = Array.isArray(result) ? result : [];
		const total = references.length;
		const truncated = total > DEFAULT_MAX_REFERENCES;
		const limited = truncated ? references.slice(0, DEFAULT_MAX_REFERENCES) : references;
		const details: LspFindReferencesDetails = {
			filePath,
			line,
			character,
			references,
			totalReferences: total,
			truncated,
		};
		if (total === 0) return text("No references found", details);
		const output = [
			...(truncated ? [`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`] : []),
			...limited.map(formatLocation),
		].join("\n");
		return text(output, details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			line,
			character,
			references: [],
			totalReferences: 0,
			truncated: false,
		} satisfies Omit<LspFindReferencesDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

async function executeLspSymbols(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const rawScope = optionalString(params, "scope") ?? "document";
	const scope = rawScope === "workspace" ? "workspace" : "document";
	const limit = Math.min(optionalNumber(params, "limit") ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS);

	try {
		if (scope === "workspace") {
			const query = optionalString(params, "query");
			if (!query) {
				const message = "Error: 'query' is required for workspace scope";
				return text(message, {
					filePath,
					scope,
					symbols: [],
					totalSymbols: 0,
					truncated: false,
					error: message,
					errorKind: "missing_query",
				});
			}

			const symbols = await withLspClient(
				filePath,
				async (client) => client.workspaceSymbols(query),
				"workspaceSymbols",
				clientOptions(signal),
			);
			return formatSymbolsResult(filePath, scope, symbols, limit, query);
		}

		const symbols = await withLspClient(
			filePath,
			async (client) => client.documentSymbols(filePath),
			"documentSymbols",
			clientOptions(signal),
		);
		return formatSymbolsResult(filePath, scope, symbols, limit);
	} catch (error) {
		const query = optionalString(params, "query");
		const missingDependency = missingDependencyResult(error, {
			filePath,
			scope,
			symbols: [],
			totalSymbols: 0,
			truncated: false,
			...(query === undefined ? {} : { query }),
		} satisfies Omit<LspSymbolsDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

function formatSymbolsResult(
	filePath: string,
	scope: "document" | "workspace",
	symbols: Array<DocumentSymbol | SymbolInfo>,
	limit: number,
	query?: string,
): ToolExecutionResult {
	const total = symbols.length;
	const truncated = total > limit;
	const limited = truncated ? symbols.slice(0, limit) : symbols;
	const details: LspSymbolsDetails = {
		filePath,
		scope,
		symbols,
		totalSymbols: total,
		truncated,
		...(query === undefined ? {} : { query }),
	};
	if (total === 0) return text("No symbols found", details);

	const lines: string[] = [];
	if (truncated) lines.push(`Found ${total} symbols (showing first ${limit}):`);
	const documentSymbols = limited.filter(isDocumentSymbol);
	if (documentSymbols.length === limited.length) {
		lines.push(...documentSymbols.map((symbol) => formatDocumentSymbol(symbol)));
	} else {
		lines.push(...limited.filter((symbol): symbol is SymbolInfo => !isDocumentSymbol(symbol)).map(formatSymbolInfo));
	}
	return text(lines.join("\n"), details);
}

async function executeLspPrepareRename(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const line = requireNumber(params, "line");
	const character = requireNumber(params, "character");

	try {
		const result = await withLspClient(
			filePath,
			async (client) => client.prepareRename(filePath, line, character),
			"prepareRename",
			clientOptions(signal),
		);
		const details: LspPrepareRenameDetails = { filePath, line, character, result };
		return text(formatPrepareRenameResult(result), details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			line,
			character,
			result: null,
		} satisfies Omit<LspPrepareRenameDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

async function executeLspRename(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const line = requireNumber(params, "line");
	const character = requireNumber(params, "character");
	const newName = requireString(params, "newName");

	try {
		const edit = await withLspClient(
			filePath,
			async (client, workspaceRoot) => ({
				edit: await client.rename(filePath, line, character, newName),
				workspaceRoot,
			}),
			"rename",
			clientOptions(signal),
		);
		const apply = applyWorkspaceEdit(edit.edit, { workspaceRoot: edit.workspaceRoot });
		const details: LspRenameDetails = { filePath, line, character, newName, apply, edit: edit.edit };
		return text(formatApplyResult(apply), details, !apply.success);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			line,
			character,
			newName,
			apply: null,
			edit: null,
		} satisfies Omit<LspRenameDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

async function executeLspInstallDecision(params: Record<string, unknown>): Promise<ToolExecutionResult> {
	const serverId = requireString(params, "server_id");
	const decision = params["decision"];
	if (!isInstallDecision(decision)) {
		return text(
			`Invalid decision '${String(decision)}'. Expected "declined" or "allowed".`,
			{ serverId, errorKind: "invalid_decision" },
			true,
		);
	}

	const serverIds = [...new Set(getMergedServers().map((server) => server.id))];
	if (!serverIds.includes(serverId)) {
		const preview = serverIds.slice(0, 20).join(", ");
		return text(
			`Unknown LSP server '${serverId}'. Known servers: ${preview}${serverIds.length > 20 ? "..." : ""}`,
			{ serverId, errorKind: "unknown_server" },
			true,
		);
	}

	recordInstallDecision(serverId, decision);
	return text(`Recorded install decision for '${serverId}': ${decision}. ${decisionFollowUp(decision)}`, {
		serverId,
		decision,
	});
}

function decisionFollowUp(decision: InstallDecision): string {
	return decision === "declined"
		? "Future LSP lookups for this server stay quiet; proceed without LSP."
		: "Future LSP lookups keep install instructions without asking the user.";
}

export async function executeLspTool(
	name: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const tool = LSP_MCP_TOOLS.find((candidate) => matchesToolName(candidate, name));
	if (!tool) throw new Error(`Unknown LSP tool: ${name}`);
	return tool.execute(params, signal);
}

function matchesToolName(tool: LspMcpTool, name: string): boolean {
	return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

export function coerceToolArguments(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export const LSP_MCP_TOOLS: LspMcpTool[] = [
	{
		name: "status",
		aliases: ["lsp_status"],
		title: "LSP Status",
		description: "List configured and active LSP servers without starting a new language server.",
		inputSchema: objectSchema({}),
		execute: executeLspStatus,
	},
	{
		name: "diagnostics",
		aliases: ["lsp_diagnostics"],
		title: "LSP Diagnostics",
		description: "Get errors, warnings, and hints for a source file or directory.",
		inputSchema: objectSchema(
			{
				filePath: { type: "string", description: "File or directory path to check." },
				severity: {
					type: "string",
					enum: ["error", "warning", "information", "hint", "all"],
					description: "Severity filter. Defaults to all.",
				},
			},
			["filePath"],
		),
		execute: executeLspDiagnostics,
	},
	{
		name: "goto_definition",
		aliases: ["lsp_goto_definition"],
		title: "LSP Goto Definition",
		description: "Find where a symbol is defined.",
		inputSchema: objectSchema(
			{
				filePath: { type: "string", description: "Source file containing the symbol." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
			},
			["filePath", "line", "character"],
		),
		execute: executeLspGotoDefinition,
	},
	{
		name: "find_references",
		aliases: ["lsp_find_references"],
		title: "LSP Find References",
		description: "Find references of a symbol across the workspace.",
		inputSchema: objectSchema(
			{
				filePath: { type: "string", description: "Source file containing the symbol." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
				includeDeclaration: { type: "boolean", description: "Include the declaration. Defaults to true." },
			},
			["filePath", "line", "character"],
		),
		execute: executeLspFindReferences,
	},
	{
		name: "symbols",
		aliases: ["lsp_symbols"],
		title: "LSP Symbols",
		description: "List document symbols or search workspace symbols.",
		inputSchema: objectSchema(
			{
				filePath: { type: "string", description: "File path used as LSP context." },
				scope: {
					type: "string",
					enum: ["document", "workspace"],
					description: "Use document for file outline or workspace for project-wide search.",
				},
				query: { type: "string", description: "Workspace symbol query." },
				limit: { type: "number", description: "Maximum number of symbols to return." },
			},
			["filePath", "scope"],
		),
		execute: executeLspSymbols,
	},
	{
		name: "prepare_rename",
		aliases: ["lsp_prepare_rename"],
		title: "LSP Prepare Rename",
		description: "Check whether a symbol can be renamed at a position.",
		inputSchema: objectSchema(
			{
				filePath: { type: "string", description: "Source file path." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
			},
			["filePath", "line", "character"],
		),
		execute: executeLspPrepareRename,
	},
	{
		name: "rename",
		aliases: ["lsp_rename"],
		title: "LSP Rename",
		description: "Rename a symbol across the workspace and apply the returned workspace edit.",
		inputSchema: objectSchema(
			{
				filePath: { type: "string", description: "Source file path." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
				newName: { type: "string", description: "New symbol name." },
			},
			["filePath", "line", "character", "newName"],
		),
		execute: executeLspRename,
	},
	{
		name: "install_decision",
		aliases: ["lsp_install_decision"],
		title: "LSP Install Decision",
		description:
			"Record whether the user allowed or declined installing a missing LSP server. Record 'declined' when the user declines, or has not explicitly asked for LSP installation, to silence future prompts.",
		inputSchema: objectSchema(
			{
				server_id: {
					type: "string",
					description: "The LSP server id from the not-installed message (e.g. 'rust').",
				},
				decision: {
					type: "string",
					enum: ["declined", "allowed"],
					description: "'declined' silences future prompts; 'allowed' pre-authorizes installation.",
				},
			},
			["server_id", "decision"],
		),
		execute: executeLspInstallDecision,
	},
];
