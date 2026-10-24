import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../../lsp-tools-mcp/src/cli.ts");
const versionKey = "io.modelcontextprotocol/protocolVersion";
const capabilitiesKey = "io.modelcontextprotocol/clientCapabilities";
const serverInfoKey = "io.modelcontextprotocol/serverInfo";
const serverInfo = { name: "lsp", version: "0.1.0" };
const supported = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"];

// This client uses the 2026-07-28 wire contract, not the legacy SDK's initialize flow.
function modernRequest(id: number, method: string, params: Record<string, unknown> = {}, version = "2026-07-28") {
	return {
		jsonrpc: "2.0",
		id,
		method,
		params: {
			...params,
			_meta: {
				[versionKey]: version,
				[capabilitiesKey]: {},
				"io.modelcontextprotocol/clientInfo": { name: "modern-stdio-fixture", version: "1.0.0" },
			},
		},
	};
}

interface RpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: Record<string, unknown>;
	error?: { code: number; data?: unknown };
}

async function exchange(requests: object[]): Promise<RpcResponse[]> {
	const directory = await mkdtemp(join(tmpdir(), "lsp-modern-stdio-"));
	try {
		const child = Bun.spawn([process.execPath, cli, "mcp"], {
			cwd: directory,
			env: {
				...process.env,
				HOME: directory,
				USERPROFILE: directory,
				LSP_TOOLS_MCP_CWD: directory,
				LSP_TOOLS_MCP_USER_CONFIG: join(directory, "user.json"),
				LSP_TOOLS_MCP_PROJECT_CONFIG: join(directory, "project.json"),
				LSP_TOOLS_MCP_INSTALL_DECISIONS: join(directory, "decisions.json"),
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			timeout: 10_000,
		});
		const output = new Response(child.stdout).text();
		const errors = new Response(child.stderr).text();
		child.stdin.write(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
		child.stdin.end();
		const [stdout, stderr, code] = await Promise.all([output, errors, child.exited]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
		return stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as RpcResponse);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe("LSP modern client over real stdio", () => {
	it("discovers versions and capabilities without initialize", async () => {
		const [response] = await exchange([modernRequest(1, "server/discover")]);
		expect(response).toMatchObject({
			id: 1,
			result: {
				resultType: "complete",
				supportedVersions: supported,
				capabilities: { tools: {} },
				_meta: { [serverInfoKey]: serverInfo },
			},
		});
	});

	it("serves inline lists, successful calls, and tool failures with modern result envelopes", async () => {
		const responses = await exchange([
			modernRequest(1, "tools/list"),
			modernRequest(2, "tools/call", { name: "status", arguments: {} }),
			modernRequest(3, "tools/call", { name: "not-a-tool", arguments: {} }),
		]);
		expect(responses).toHaveLength(3);
		for (const response of responses) {
			expect(response.error).toBeUndefined();
			expect(response.result).toMatchObject({
				resultType: "complete",
				_meta: { [serverInfoKey]: serverInfo },
			});
		}
		expect(responses[0]?.result?.["tools"]).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "status" })]),
		);
		expect(responses[0]?.result).toMatchObject({ ttlMs: 0, cacheScope: "public" });
		expect(responses[1]?.result?.["isError"]).toBe(false);
		expect(responses[2]?.result?.["isError"]).toBe(true);
	});

	it("rejects each unsupported version before dispatch and accepts a supported retry", async () => {
		const responses = await exchange([
			modernRequest(1, "server/discover", {}, "1900-01-01"),
			modernRequest(2, "tools/call", { name: "status" }, "2099-01-01"),
			modernRequest(3, "tools/list"),
		]);
		expect(responses[0]).toMatchObject({
			id: 1,
			error: { code: -32022, data: { supported, requested: "1900-01-01" } },
		});
		expect(responses[1]).toMatchObject({
			id: 2,
			error: { code: -32022, data: { supported, requested: "2099-01-01" } },
		});
		expect(responses[2]?.result?.["resultType"]).toBe("complete");
	});

	it.each<Record<string, unknown>>([
		{ [versionKey]: "2026-07-28" },
		{ [capabilitiesKey]: {} },
		{ [versionKey]: 42, [capabilitiesKey]: {} },
		{ [versionKey]: "2026-07-28", [capabilitiesKey]: null },
	])("rejects malformed modern metadata %j", async (_meta) => {
		const [response] = await exchange([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta } }]);
		expect(response).toMatchObject({ id: 1, error: { code: -32602 } });
	});

	it.each([
		{ method: "notifications/initialized", params: modernRequest(1, "notifications/initialized").params },
		{ method: "tools/list", params: { _meta: { [versionKey]: "2026-07-28" } } },
		{ method: "tools/list", params: modernRequest(1, "tools/list", {}, "2099-01-01").params },
		{ method: "legacy/unknown" },
		{ method: "tools/list" },
		{ method: "tools/call", params: modernRequest(1, "tools/call", { name: "status", arguments: {} }).params },
	])("never replies to an id-less notification %j", async (notification) => {
		const responses = await exchange([
			{ jsonrpc: "2.0", ...notification },
			{ jsonrpc: "2.0", id: 0, method: "ping" },
		]);
		expect(responses).toEqual([{ jsonrpc: "2.0", id: 0, result: {} }]);
	});

	it.each(["2025-06-18", "2025-03-26", "2024-11-05"])(
		"rejects legacy per-request metadata version %s without dispatch",
		async (version) => {
			const responses = await exchange([
				modernRequest(1, "server/discover", {}, version),
				modernRequest(2, "tools/list", {}, version),
				modernRequest(3, "tools/call", { name: "status", arguments: {} }, version),
			]);
			expect(responses).toHaveLength(3);
			for (const response of responses) {
				expect(response).toMatchObject({
					error: { code: -32022, data: { supported, requested: version } },
				});
			}
		},
	);

	it.each(["2025-06-18", "2025-03-26", "2024-11-05"])(
		"preserves the legacy initialize and tool-call flow for %s",
		async (protocolVersion) => {
			const responses = await exchange([
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {} } },
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } },
			]);
			expect(responses).toHaveLength(2);
			expect(responses[0]?.result).toEqual({
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo,
			});
			expect(responses[1]?.result?.["isError"]).toBe(false);
			expect(responses[1]?.result).not.toHaveProperty("resultType");
			expect(responses[1]?.result).not.toHaveProperty("_meta");
		},
	);

	it("does not retain a previous request's modern era or replace legacy initialize negotiation", async () => {
		const responses = await exchange([
			modernRequest(1, "tools/list"),
			{ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {} } },
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 3, method: "ping" },
			{ jsonrpc: "2.0", id: 4, method: "tools/list" },
			modernRequest(5, "tools/list"),
		]);
		expect(responses).toHaveLength(5);
		expect(responses[1]).toEqual({
			jsonrpc: "2.0",
			id: 2,
			result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo },
		});
		expect(responses[2]).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
		expect(responses[3]?.result).not.toHaveProperty("resultType");
		expect(responses[3]?.result).not.toHaveProperty("_meta");
		expect(responses[4]?.result?.["resultType"]).toBe("complete");
	});
});
