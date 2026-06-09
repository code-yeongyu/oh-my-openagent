import { describe, expect, it } from "vitest";

import { extractRequestContext } from "../src/request-routing.js";

describe("extractRequestContext", () => {
	it("#given a non tools/call message #when extract #then no context and input unchanged", () => {
		const raw = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
		const routed = extractRequestContext(raw);
		expect(routed.context).toBeUndefined();
		expect(routed.input).toBe(raw);
	});

	it("#given tools/call with _context #when extract #then context parsed and stripped from arguments", () => {
		const raw = {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "diagnostics",
				arguments: { filePath: "/a.ts", _context: { cwd: "/proj", env: { LSP_TOOLS_MCP_USER_CONFIG: "/u.json" } } },
			},
		};
		const routed = extractRequestContext(raw);
		expect(routed.context).toEqual({ cwd: "/proj", env: { LSP_TOOLS_MCP_USER_CONFIG: "/u.json" } });
		const args = (routed.input as { params: { arguments: Record<string, unknown> } }).params.arguments;
		expect(args).toEqual({ filePath: "/a.ts" });
		expect("_context" in args).toBe(false);
	});

	it("#given tools/call without _context #when extract #then no context", () => {
		const raw = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: {} } };
		const routed = extractRequestContext(raw);
		expect(routed.context).toBeUndefined();
	});

	it("#given tools/call with empty _context #when extract #then no context", () => {
		const raw = {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "status", arguments: { _context: {} } },
		};
		const routed = extractRequestContext(raw);
		expect(routed.context).toBeUndefined();
	});
});
