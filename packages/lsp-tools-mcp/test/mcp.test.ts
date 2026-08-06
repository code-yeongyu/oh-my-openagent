import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleLspMcpRequest } from "../src/mcp.js";
import {
	createStandaloneMcpRequestContext,
	runWithRequestContext,
	type LspRequestContext,
} from "../src/request-context.js";

describe("lsp MCP server", () => {
	it("responds to initialize with tool capabilities", async () => {
		const response = await handleLspMcpRequest({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test", version: "0.0.0" },
			},
		});

		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "lsp", version: "0.1.0" },
			},
		});
	});

	it("lists LSP MCP tools", async () => {
		const response = await handleLspMcpRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
		});

		const tools = response?.result?.tools as Array<{ name: string }>;
		expect(tools.map((tool) => tool.name)).toEqual([
			"status",
			"diagnostics",
			"goto_definition",
			"find_references",
			"symbols",
			"prepare_rename",
			"rename",
			"install_decision",
		]);
	});

	it("calls status without starting a language server", async () => {
		const response = await runWithRequestContext(createStandaloneMcpRequestContext(), () =>
			handleLspMcpRequest({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "status", arguments: {} },
			}),
		);

		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 3,
			result: {
				isError: false,
			},
		});
		expect(response?.result?.content?.[0]?.text).toContain("Configured LSP servers");
	});

	it("accepts legacy lsp-prefixed tool names without listing them", async () => {
		const response = await runWithRequestContext(createStandaloneMcpRequestContext(), () =>
			handleLspMcpRequest({
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: "lsp_status", arguments: {} },
			}),
		);

		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 4,
			result: {
				isError: false,
			},
		});
		expect(response?.result?.content?.[0]?.text).toContain("Configured LSP servers");
	});
});

describe("lsp MCP install_decision routing", () => {
	const tempDirectories: string[] = [];
	const saved = new Map<string, string | undefined>();
	let requestContext: LspRequestContext;

	function setEnv(name: string, value: string): void {
		if (!saved.has(name)) saved.set(name, process.env[name]);
		process.env[name] = value;
	}

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), "lsp-mcp-decisions-"));
		tempDirectories.push(dir);
		setEnv("LSP_TOOLS_MCP_INSTALL_DECISIONS", join(dir, "lsp-install-decisions.json"));
		setEnv("LSP_TOOLS_MCP_USER_CONFIG", join(dir, "absent-user.json"));
		setEnv("LSP_TOOLS_MCP_PROJECT_CONFIG", "absent-project.json");
		requestContext = createStandaloneMcpRequestContext({ cwd: dir });
	});

	afterEach(() => {
		for (const [name, value] of saved) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		saved.clear();
		for (const directory of tempDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("routes install_decision tool calls", async () => {
		const response = await runWithRequestContext(requestContext, () =>
			handleLspMcpRequest({
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: { name: "install_decision", arguments: { server_id: "typescript", decision: "declined" } },
			}),
		);

		expect(response).toMatchObject({ jsonrpc: "2.0", id: 5, result: { isError: false } });
		expect(response?.result?.content?.[0]?.text).toContain("typescript");
	});

	it("routes the legacy lsp_install_decision alias", async () => {
		const response = await runWithRequestContext(requestContext, () =>
			handleLspMcpRequest({
				jsonrpc: "2.0",
				id: 6,
				method: "tools/call",
				params: { name: "lsp_install_decision", arguments: { server_id: "typescript", decision: "allowed" } },
			}),
		);

		expect(response).toMatchObject({ jsonrpc: "2.0", id: 6, result: { isError: false } });
	});
});
