import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { resolveLazyLspIdleTimeoutMs, runLazyLspMcpServer } from "../src/lazy-lsp-mcp.js";
import { DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS } from "../src/lazy-mcp-proxy.js";

describe("lazy LSP MCP config", () => {
	it("#given idle timeout env input #when resolving lazy LSP config #then default and malformed values are safe", () => {
		// given
		const fallback = DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS;

		// when
		const missing = resolveLazyLspIdleTimeoutMs(undefined, fallback);
		const valid = resolveLazyLspIdleTimeoutMs("25", fallback);
		const malformed = resolveLazyLspIdleTimeoutMs("abc", fallback);

		// then
		expect(missing).toEqual({ value: fallback });
		expect(valid).toEqual({ value: 25 });
		expect(malformed.value).toBe(fallback);
		expect(malformed.warning).toContain("Ignoring malformed lazy MCP idle timeout");
	});

	it("#given missing lazy backend config #when metadata requests are served #then the server stays usable without starting a backend", async () => {
		// given
		const input = new PassThrough();
		const output = new PassThrough();
		const chunks: string[] = [];
		const previousBackendConfig = process.env["CODEX_LSP_LAZY_BACKEND"];
		delete process.env["CODEX_LSP_LAZY_BACKEND"];
		output.on("data", (chunk: Buffer | string) => {
			chunks.push(chunk.toString());
		});

		try {
			const server = runLazyLspMcpServer(input, output);

			// when
			input.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test" } },
				})}\n`,
			);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
			input.end();
			await server;
		} finally {
			restoreEnv("CODEX_LSP_LAZY_BACKEND", previousBackendConfig);
		}

		// then
		const responses = parseJsonRpcResponses(chunks.join(""));
		expect(responses).toHaveLength(2);
		expect(responses[0]?.result?.serverInfo).toEqual({ name: "lsp", version: "0.2.0" });
		expect(toolNames(responses[1])).toContain("status");
	});
});

interface JsonRpcTestResponse {
	readonly result?: {
		readonly serverInfo?: unknown;
		readonly tools?: unknown;
	};
}

function parseJsonRpcResponses(output: string): readonly JsonRpcTestResponse[] {
	return output
		.trim()
		.split(/\n+/)
		.filter((line) => line.length > 0)
		.map((line) => {
			const parsed: unknown = JSON.parse(line);
			return isJsonRpcTestResponse(parsed) ? parsed : {};
		});
}

function toolNames(response: JsonRpcTestResponse | undefined): readonly string[] {
	const tools = response?.result?.tools;
	if (!Array.isArray(tools)) return [];
	return tools.flatMap((tool) => {
		if (!isRecord(tool) || typeof tool["name"] !== "string") return [];
		return [tool["name"]];
	});
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

function isJsonRpcTestResponse(value: unknown): value is JsonRpcTestResponse {
	return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
