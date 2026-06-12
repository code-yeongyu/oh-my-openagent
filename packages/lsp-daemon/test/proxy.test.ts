import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { type DaemonServerHandle, startDaemonServer } from "../src/daemon-server.js";
import { type DaemonPaths, daemonPaths } from "../src/paths.js";
import { runMcpStdioProxy } from "../src/proxy.js";

const tempDirectories: string[] = [];
const servers: DaemonServerHandle[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-proxy-"));
	tempDirectories.push(dir);
	return daemonPaths({ CODEX_LSP_DAEMON_DIR: dir }, "test");
}

function inputStream(messages: object[]): Readable {
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

function parseResponses(chunks: string[]): Array<Record<string, unknown>> {
	return chunks
		.join("")
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

const noSpawn = (): Promise<void> => Promise.resolve();

describe("mcp stdio proxy", () => {
	it("#given initialize and tools/call #when proxied #then initialize is local and the tool goes to the daemon", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);
		const out: string[] = [];

		await runMcpStdioProxy({
			input: inputStream([
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } },
			]),
			output: collectingWritable(out),
			paths,
			ensure: noSpawn,
		});

		const responses = parseResponses(out);
		expect((responses[0]?.["result"] as { serverInfo?: unknown }).serverInfo).toBeDefined();
		const toolResult = responses[1]?.["result"] as { content: Array<{ text: string }> };
		expect(toolResult.content[0]?.text).toContain("Configured LSP servers");
	});

	it("#given an unreachable daemon #when a tool is proxied #then it returns a structured error instead of running locally", async () => {
		const paths = tempPaths();
		const out: string[] = [];

		await runMcpStdioProxy({
			input: inputStream([
				{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "status", arguments: {} } },
			]),
			output: collectingWritable(out),
			paths,
			ensure: () => Promise.reject(new Error("spawn disabled")),
		});

		const responses = parseResponses(out);
		const toolResult = responses[0]?.["result"] as { content: Array<{ text: string }>; isError?: boolean };
		expect(toolResult.isError).toBe(true);
		expect(toolResult.content[0]?.text).toContain("LSP daemon unreachable");
		expect(toolResult.content[0]?.text).not.toContain("Configured LSP servers");
	});

	it("#given a malformed line #when proxied #then returns a parse error", async () => {
		const paths = tempPaths();
		const out: string[] = [];

		await runMcpStdioProxy({
			input: Readable.from(["not-json\n"]),
			output: collectingWritable(out),
			paths,
			ensure: noSpawn,
		});

		const responses = parseResponses(out);
		expect((responses[0]?.["error"] as { code: number }).code).toBe(-32700);
	});

	it("#given an unreachable daemon #when several tools are proxied #then each gets a structured error and the proxy keeps serving", async () => {
		const paths = tempPaths();
		const out: string[] = [];

		await runMcpStdioProxy({
			input: inputStream([
				{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "definitely_not_a_tool", arguments: {} } },
				{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } },
			]),
			output: collectingWritable(out),
			paths,
			ensure: () => Promise.reject(new Error("spawn disabled")),
		});

		const responses = parseResponses(out);
		const first = responses.find((response) => response["id"] === 1);
		const second = responses.find((response) => response["id"] === 2);
		expect((first?.["result"] as { isError?: boolean })?.isError).toBe(true);
		const secondResult = second?.["result"] as { content: Array<{ text: string }>; isError?: boolean } | undefined;
		expect(secondResult?.isError).toBe(true);
		expect(secondResult?.content[0]?.text).toContain("LSP daemon unreachable");
	});
});
