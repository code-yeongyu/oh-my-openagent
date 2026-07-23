import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { runCodegraphServe } from "../src/serve.ts";
import {
	arrayProperty,
	CODEGRAPH_141_DEFAULT_TOOLS,
	findTool,
	frameMcpRequest,
	parseMcpBodies,
	recordProperty,
	recordValue,
	stringProperty,
	writeFakeContractCodegraph,
	writeFakeHeldOpenCodegraph,
	writeFakeNewlineCodegraph,
} from "./mcp-bridge-fixtures.ts";

const componentRoot = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

describe("runCodegraphServe MCP protocol bridge", () => {
	it("#given Codex framed stdio and a newline-json CodeGraph child #when listing tools #then it bridges frames and serves from the project cwd", async () => {
		// given
		const tempRoot = mkdtempSync(join(componentRoot, ".tmp-codegraph-bridge-"));
		const projectRoot = join(tempRoot, "project");
		const pluginCacheRoot = join(tempRoot, "plugin-cache");
		const fakeCodegraph = join(tempRoot, "codegraph-fake.cjs");
		const childLog = join(tempRoot, "child.log");
		const input = new PassThrough();
		const output = new PassThrough();
		let stdout = "";
		output.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});

		try {
			mkdirSync(projectRoot, { recursive: true });
			mkdirSync(pluginCacheRoot, { recursive: true });
			writeFakeNewlineCodegraph(fakeCodegraph);

			const run = runCodegraphServe({
				cwd: pluginCacheRoot,
				env: {
					CODEGRAPH_ALLOW_UNSAFE_NODE: "1",
					CODEGRAPH_FAKE_LOG: childLog,
					OMO_CODEGRAPH_BIN: fakeCodegraph,
					OMO_CODEGRAPH_PROJECT_CWD: projectRoot,
					PATH: process.env["PATH"],
				},
				nodeVersion: "22.14.0",
				buildEnv: () => ({}),
				resolve: () => ({ argsPrefix: [], command: fakeCodegraph, exists: true, source: "env" }),
				stderr: { write: () => undefined },
				stdin: input,
				stdout: output,
			});

			// when
			input.end([
				frameMcpRequest({
					id: 1,
					method: "initialize",
					params: {
						capabilities: {},
						clientInfo: { name: "codex", version: "0.141.0" },
						protocolVersion: "2025-06-18",
					},
				}),
				frameMcpRequest({
					id: 2,
					method: "tools/list",
					params: {},
				}),
			].join(""));
			const exitCode = await run;

			// then
			expect(exitCode).toBe(0);
			const bodies = parseMcpBodies(stdout);
			expect(bodies).toEqual([
				{
					id: 1,
					jsonrpc: "2.0",
					result: {
						capabilities: { tools: { listChanged: false } },
						protocolVersion: "2025-06-18",
						serverInfo: { name: "codegraph", version: "1.4.1" },
					},
				},
				{
					id: 2,
					jsonrpc: "2.0",
					result: {
						tools: CODEGRAPH_141_DEFAULT_TOOLS,
					},
				},
			]);
			expect(readFileSync(childLog, "utf8")).toContain(`cwd=${realpathSync(projectRoot)}`);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given old upstream codegraph_node metadata and container outline guidance #when bridging #then it exposes the corrected LazyCodex contract", async () => {
		// given
		const tempRoot = mkdtempSync(join(componentRoot, ".tmp-codegraph-contract-"));
		const projectRoot = join(tempRoot, "project");
		const fakeCodegraph = join(tempRoot, "codegraph-contract-fake.cjs");
		const childLog = join(tempRoot, "child.log");
		const input = new PassThrough();
		const output = new PassThrough();
		let stdout = "";
		output.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});

		try {
			mkdirSync(projectRoot, { recursive: true });
			writeFakeContractCodegraph(fakeCodegraph);

			const run = runCodegraphServe({
				cwd: tempRoot,
				env: {
					CODEGRAPH_ALLOW_UNSAFE_NODE: "1",
					CODEGRAPH_FAKE_LOG: childLog,
					OMO_CODEGRAPH_BIN: fakeCodegraph,
					OMO_CODEGRAPH_PROJECT_CWD: projectRoot,
					PATH: process.env["PATH"],
				},
				nodeVersion: "22.14.0",
				buildEnv: () => ({}),
				resolve: () => ({ argsPrefix: [], command: fakeCodegraph, exists: true, source: "env" }),
				stderr: { write: () => undefined },
				stdin: input,
				stdout: output,
			});

			// when
			input.end([
				frameMcpRequest({
					id: 1,
					method: "tools/list",
					params: {},
				}),
				frameMcpRequest({
					id: 2,
					method: "tools/call",
					params: {
						arguments: { includeCode: true, symbol: "JsonlMCP" },
						name: "codegraph_node",
					},
				}),
			].join(""));
			const exitCode = await run;

			// then
			expect(exitCode).toBe(0);
			const bodies = parseMcpBodies(stdout);
			const tools = arrayProperty(recordProperty(recordValue(bodies[0]), "result"), "tools");
			const nodeTool = findTool(tools, "codegraph_node");
			const searchTool = findTool(tools, "codegraph_search");
			expect(stringProperty(nodeTool, "description")).toContain("Container symbols");
			expect(stringProperty(nodeTool, "description")).toContain("file mode");
			expect(stringProperty(nodeTool, "description")).not.toContain("verbatim source");
			expect(stringProperty(nodeTool, "description")).not.toContain("full body");
			expect(
				stringProperty(
					recordProperty(recordProperty(recordProperty(nodeTool, "inputSchema"), "properties"), "includeCode"),
					"description",
				),
			).toBe(
				"Symbol mode: include leaf-symbol source when available. Container symbols such as classes, interfaces, structs, enums, modules, and namespaces intentionally return structural outlines with members; request a specific member symbol or use file mode with symbolsOnly=false plus offset/limit for source.",
			);
			expect(searchTool).toEqual({ description: "search stays unchanged", name: "codegraph_search" });

			const callResult = recordProperty(recordValue(bodies[1]), "result");
			const text = stringProperty(recordValue(arrayProperty(callResult, "content")[0]), "text");
			expect(text).toContain("Container symbols intentionally return structural outlines");
			expect(text).toContain("specific member symbol");
			expect(text).toContain("file mode");
			expect(text).toContain("symbolsOnly=false");
			expect(text).not.toContain("Read tool");
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given a held-open Codegraph child and closed parent output #when response forwarding fails #then the child is terminated before rejection", async () => {
		const tempRoot = mkdtempSync(join(componentRoot, ".tmp-codegraph-output-failure-"));
		const projectRoot = join(tempRoot, "project");
		const fakeCodegraph = join(tempRoot, "codegraph-held-open.cjs");
		const childPidFile = join(tempRoot, "child.pid");
		const input = new PassThrough();
		const outputError = Object.assign(new Error("parent output closed"), { code: "EPIPE" });
		const output = new Writable({
			write(_chunk, _encoding, callback) {
				callback(outputError);
			},
		});
		let childPid: number | undefined;

		try {
			mkdirSync(projectRoot, { recursive: true });
			writeFakeHeldOpenCodegraph(fakeCodegraph);
			const run = runCodegraphServe({
				cwd: tempRoot,
				env: {
					CODEGRAPH_ALLOW_UNSAFE_NODE: "1",
					CODEGRAPH_FAKE_LOG: childPidFile,
					OMO_CODEGRAPH_BIN: fakeCodegraph,
					OMO_CODEGRAPH_PROJECT_CWD: projectRoot,
					PATH: process.env["PATH"],
				},
				nodeVersion: "22.14.0",
				buildEnv: () => ({}),
				resolve: () => ({ argsPrefix: [], command: fakeCodegraph, exists: true, source: "env" }),
				stderr: { write: () => undefined },
				stdin: input,
				stdout: output,
			});

			input.end(frameMcpRequest({ id: 1, method: "tools/list", params: {} }));

			await expect(run).rejects.toBe(outputError);
			childPid = Number(readFileSync(childPidFile, "utf8"));
			expect(isProcessAlive(childPid)).toBe(false);
		} finally {
			if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
		throw error;
	}
}
