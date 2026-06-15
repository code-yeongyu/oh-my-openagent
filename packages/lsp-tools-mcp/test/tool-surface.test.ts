import { describe, expect, it } from "vitest";

import { handleLspMcpRequest } from "../src/mcp.js";

const expectedToolSurface = [
	{
		name: "status",
		title: "LSP Status",
		description: "List configured and active LSP servers without starting a new language server.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "diagnostics",
		title: "LSP Diagnostics",
		description: "Get errors, warnings, and hints for a source file or directory.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string", description: "File or directory path to check." },
				severity: {
					type: "string",
					enum: ["error", "warning", "information", "hint", "all"],
					description: "Severity filter. Defaults to all.",
				},
			},
			required: ["filePath"],
		},
	},
	{
		name: "goto_definition",
		title: "LSP Goto Definition",
		description: "Find where a symbol is defined.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string", description: "Source file containing the symbol." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
			},
			required: ["filePath", "line", "character"],
		},
	},
	{
		name: "find_references",
		title: "LSP Find References",
		description: "Find references of a symbol across the workspace.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string", description: "Source file containing the symbol." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
				includeDeclaration: { type: "boolean", description: "Include the declaration. Defaults to true." },
			},
			required: ["filePath", "line", "character"],
		},
	},
	{
		name: "symbols",
		title: "LSP Symbols",
		description: "List document symbols or search workspace symbols.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string", description: "File path used as LSP context." },
				scope: {
					type: "string",
					enum: ["document", "workspace"],
					description: "Use document for file outline or workspace for project-wide search.",
				},
				query: { type: "string", description: "Workspace symbol query." },
				limit: { type: "number", description: "Maximum number of symbols to return." },
			},
			required: ["filePath", "scope"],
		},
	},
	{
		name: "prepare_rename",
		title: "LSP Prepare Rename",
		description: "Check whether a symbol can be renamed at a position.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string", description: "Source file path." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
			},
			required: ["filePath", "line", "character"],
		},
	},
	{
		name: "rename",
		title: "LSP Rename",
		description: "Rename a symbol across the workspace and apply the returned workspace edit.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string", description: "Source file path." },
				line: { type: "number", description: "1-based line number." },
				character: { type: "number", description: "0-based column." },
				newName: { type: "string", description: "New symbol name." },
			},
			required: ["filePath", "line", "character", "newName"],
		},
	},
	{
		name: "install_decision",
		title: "LSP Install Decision",
		description:
			"Record whether the user allowed or declined installing a missing LSP server. Record 'declined' when the user declines, or has not explicitly asked for LSP installation, to silence future prompts.",
		inputSchema: {
			type: "object",
			properties: {
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
			required: ["server_id", "decision"],
		},
	},
] as const;

describe("LSP MCP tool surface", () => {
	it("#given a JSON-RPC tools/list request #when descriptors are returned #then the eight public tool schemas are pinned", async () => {
		// given
		const request = { jsonrpc: "2.0", id: 21, method: "tools/list" };

		// when
		const response = await handleLspMcpRequest(request);

		// then
		expect(response?.result?.tools).toEqual(expectedToolSurface);
	});

	it("#given a legacy lsp-prefixed tool alias #when called through JSON-RPC #then aliases remain callable but unlisted", async () => {
		// given
		const request = {
			jsonrpc: "2.0",
			id: 22,
			method: "tools/call",
			params: { name: "lsp_diagnostics", arguments: { filePath: "module.wat" } },
		};

		// when
		const callResponse = await handleLspMcpRequest(request);
		const listResponse = await handleLspMcpRequest({ jsonrpc: "2.0", id: 23, method: "tools/list" });

		// then
		expect(callResponse?.result?.isError).toBe(false);
		expect(callResponse?.result?.content?.[0]?.text).toContain("No LSP server configured for extension: .wat");
		expect(listResponse?.result?.tools?.map((tool) => tool.name)).not.toContain("lsp_diagnostics");
	});
});
