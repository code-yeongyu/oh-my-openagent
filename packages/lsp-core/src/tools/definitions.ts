import { executeLspDiagnostics } from "./diagnostics.js";
import { executeLspInstallDecision } from "./install-decision.js";
import { executeLspFindReferences, executeLspGotoDefinition } from "./navigation.js";
import { executeLspPrepareRename, executeLspRename } from "./rename.js";
import { objectSchema } from "./schema.js";
import { executeLspStatus } from "./status.js";
import { executeLspSymbols } from "./symbols.js";
import type { LspMcpTool } from "./types.js";

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
