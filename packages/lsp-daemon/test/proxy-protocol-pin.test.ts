import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import type { DaemonPaths } from "../src/paths.js";
import { runMcpStdioProxy } from "../src/proxy.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

describe("lsp-daemon MCP proxy protocol pins", () => {
	it("given initialize request when proxied then exact server info and capabilities stay stable", async () => {
		const out: string[] = [];

		await runMcpStdioProxy({
			input: inputStream([
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
			]),
			output: collectingWritable(out),
			paths: inertPaths(),
			ensure: noSpawn,
		});

		expect(parseSingleResponse(out)).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: {
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "lsp", version: "0.1.0" },
				protocolVersion: "2024-11-05",
			},
		});
	});

	it("given malformed stdio line when proxied then parse error envelope includes parser data", async () => {
		const out: string[] = [];

		await runMcpStdioProxy({
			input: Readable.from(["garbage\n"]),
			output: collectingWritable(out),
			paths: inertPaths(),
			ensure: noSpawn,
		});

		expect(parseSingleResponse(out)).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32700,
				message: "Parse error",
				data: "Unexpected token 'g', \"garbage\" is not valid JSON",
			},
		});
	});
});

const noSpawn = (): Promise<void> => Promise.resolve();

function inertPaths(): DaemonPaths {
	return daemonTestPaths("/tmp/omo-lsp-daemon-protocol-pin");
}

function inputStream(messages: readonly object[]): Readable {
	return Readable.from([`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`]);
}

function collectingWritable(chunks: string[]): Writable {
	return new Writable({
		write(chunk, _encoding, callback): void {
			chunks.push(chunk.toString());
			callback();
		},
	});
}

function parseSingleResponse(chunks: readonly string[]): unknown {
	return JSON.parse(chunks.join("").trim());
}
