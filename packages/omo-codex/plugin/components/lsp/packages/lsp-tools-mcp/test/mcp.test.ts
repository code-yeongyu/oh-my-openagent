import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { handleLspMcpRequest, runMcpStdioServer } from "../src/mcp.js";

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
		]);
	});

	it("calls status without starting a language server", async () => {
		const response = await handleLspMcpRequest({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "status", arguments: {} },
		});

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
		const response = await handleLspMcpRequest({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "lsp_status", arguments: {} },
		});

		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 4,
			result: {
				isError: false,
			},
		});
		expect(response?.result?.content?.[0]?.text).toContain("Configured LSP servers");
	});

	it("#given idle stdio connection #when no request arrives before timeout #then server exits through idle callback", async () => {
		// given
		const input = new PassThrough();
		const output = new PassThrough();
		let idleCallCount = 0;

		// when
		await runMcpStdioServer(input, output, {
			idleTimeoutMs: 1,
			onIdleTimeout: () => {
				idleCallCount++;
				input.end();
			},
		});

		// then
		expect(idleCallCount).toBe(1);
	});
});
