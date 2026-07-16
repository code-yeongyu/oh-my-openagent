import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type DaemonServerHandle, startDaemonServer } from "../src/daemon-server.js";
import type { DaemonPaths } from "../src/paths.js";
import { runMcpStdioProxy } from "../src/proxy.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const tempDirectories: string[] = [];
const servers: DaemonServerHandle[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-proxy-"));
	tempDirectories.push(dir);
	return daemonTestPaths(dir);
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

	it("#given OpenCode LSP env #when tools are proxied #then daemon requests use the env-derived typed context", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);
		const projectRoot = mkdtempSync(join(tmpdir(), "lsp-daemon-opencode-context-"));
		const homeRoot = mkdtempSync(join(tmpdir(), "lsp-daemon-opencode-home-"));
		tempDirectories.push(projectRoot, homeRoot);
		const opencodeConfig = join(projectRoot, ".opencode", "lsp.json");
		const omoConfig = join(projectRoot, ".omo", "lsp.json");
		const omoClientConfig = join(projectRoot, ".omo", "lsp-client.json");
		const userConfig = join(homeRoot, "opencode", "lsp.json");
		const decisionsPath = join(homeRoot, "opencode", "lsp-install-decisions.json");
		mkdirSync(join(projectRoot, ".opencode"), { recursive: true });
		mkdirSync(join(projectRoot, ".omo"), { recursive: true });
		mkdirSync(join(homeRoot, "opencode"), { recursive: true });
		writeFileSync(opencodeConfig, JSON.stringify({ lsp: { typescript: { disabled: true } } }));
		writeFileSync(omoConfig, JSON.stringify({ lsp: { typescript: { priority: 99 } } }));
		writeFileSync(omoClientConfig, JSON.stringify({ lsp: { deno: { disabled: true } } }));
		writeFileSync(userConfig, JSON.stringify({ lsp: { "user-context-proof": { command: ["user-ls"], extensions: [".user"] } } }));
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const previousDecisions = process.env["LSP_TOOLS_MCP_INSTALL_DECISIONS"];
		process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = [opencodeConfig, omoConfig, omoClientConfig].join(delimiter);
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = userConfig;
		process.env["LSP_TOOLS_MCP_INSTALL_DECISIONS"] = decisionsPath;
		try {
			const out: string[] = [];
			await runMcpStdioProxy({
				input: inputStream([
					{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: {} } },
					{
						jsonrpc: "2.0",
						id: 4,
						method: "tools/call",
						params: { name: "install_decision", arguments: { server_id: "deno", decision: "declined" } },
					},
				]),
				output: collectingWritable(out),
				paths,
				ensure: noSpawn,
			});

			const responses = parseResponses(out);
			const status = responses.find((response) => response["id"] === 3)?.["result"] as
				| { readonly content: readonly { readonly text: string }[] }
				| undefined;
			const decision = responses.find((response) => response["id"] === 4)?.["result"] as
				| { readonly isError?: boolean }
				| undefined;
			const statusText = status?.content[0]?.text ?? "";
			expect(statusText).toContain("- typescript: disabled");
			expect(statusText).toContain("- user-context-proof: missing; source=user");
			expect(decision?.isError).toBe(false);
			expect(existsSync(decisionsPath)).toBe(true);
			expect(readFileSync(decisionsPath, "utf8")).toContain("deno");
		} finally {
			restoreEnv("LSP_TOOLS_MCP_PROJECT_CONFIG", previousProject);
			restoreEnv("LSP_TOOLS_MCP_USER_CONFIG", previousUser);
			restoreEnv("LSP_TOOLS_MCP_INSTALL_DECISIONS", previousDecisions);
		}
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

	it("#given an initialized idle proxy #when the next request arrives after ten minutes #then it still responds", async () => {
		vi.useFakeTimers();
		try {
			const paths = tempPaths();
			const input = new PassThrough();
			const out: string[] = [];
			const server = runMcpStdioProxy({
				input,
				output: collectingWritable(out),
				paths,
				ensure: noSpawn,
			});

			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 6, method: "initialize", params: {} })}\n`);
			await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
			input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} })}\n`);
			await server;

			const responses = parseResponses(out);
			expect((responses[0]?.["result"] as { serverInfo?: unknown }).serverInfo).toBeDefined();
			expect((responses[1]?.["result"] as { serverInfo?: unknown }).serverInfo).toBeDefined();
		} finally {
			vi.useRealTimers();
		}
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

function restoreEnv(name: string, previous: string | undefined): void {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
}
