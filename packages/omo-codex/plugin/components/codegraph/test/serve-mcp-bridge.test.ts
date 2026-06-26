import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runCodegraphServe } from "../src/serve.ts";
import { frameMcpRequest, parseMcpBodies, writeFakeNewlineCodegraph } from "./serve-mcp-test-helpers.ts";

describe("runCodegraphServe MCP protocol bridge", () => {
	it("#given Codex framed stdio and a newline-json CodeGraph child #when listing tools #then it bridges frames and serves from the project cwd", async () => {
		// given
		const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-bridge-"));
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
						serverInfo: { name: "codegraph", version: "1.1.1" },
					},
				},
				{
					id: 2,
					jsonrpc: "2.0",
					result: {
						tools: [
							{ name: "codegraph_search" },
							{ name: "codegraph_node" },
							{ name: "codegraph_explore" },
							{ name: "codegraph_callers" },
						],
					},
				},
			]);
			expect(readFileSync(childLog, "utf8").trim().split("\n")).toEqual([
				`status:${realpathSync(projectRoot)}`,
				`sync:${realpathSync(projectRoot)}`,
				`serve:${realpathSync(projectRoot)}`,
			]);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given a framed secondary project call #when serving through the Codex adapter #then it refreshes before forwarding and keeps framed responses", async () => {
		// given
		const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-bridge-refresh-"));
		const projectRoot = join(tempRoot, "project");
		const secondaryProject = join(tempRoot, "secondary");
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
			mkdirSync(join(projectRoot, ".codegraph"), { recursive: true });
			mkdirSync(join(secondaryProject, ".codegraph"), { recursive: true });
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
					method: "tools/call",
					params: {
						arguments: {
							projectPath: secondaryProject,
							query: "freshSymbol",
						},
						name: "codegraph_search",
					},
				}),
			].join(""));
			const exitCode = await run;

			// then
			expect(exitCode).toBe(0);
			expect(parseMcpBodies(stdout)).toEqual([
				{
					id: 1,
					jsonrpc: "2.0",
					result: {
						capabilities: { tools: { listChanged: false } },
						protocolVersion: "2025-06-18",
						serverInfo: { name: "codegraph", version: "1.1.1" },
					},
				},
				{
					id: 2,
					jsonrpc: "2.0",
					result: {
						content: [{ text: "fresh secondary result", type: "text" }],
					},
				},
			]);
			const logLines = readFileSync(childLog, "utf8").trim().split("\n");
			const projectStatus = `status:${realpathSync(projectRoot)}`;
			const projectSync = `sync:${realpathSync(projectRoot)}`;
			const projectServe = `serve:${realpathSync(projectRoot)}`;
			const secondaryStatus = `status:${realpathSync(secondaryProject)}`;
			const secondarySync = `sync:${realpathSync(secondaryProject)}`;
			const forwardedRequest = `request:${secondaryProject}:freshSymbol`;
			expect(logLines).toContain(projectStatus);
			expect(logLines).toContain(projectSync);
			expect(logLines).toContain(projectServe);
			expect(logLines).toContain(secondaryStatus);
			expect(logLines).toContain(secondarySync);
			expect(logLines).toContain(forwardedRequest);
			expect(logLines.indexOf(projectStatus)).toBeLessThan(logLines.indexOf(projectSync));
			expect(logLines.indexOf(secondaryStatus)).toBeLessThan(logLines.indexOf(secondarySync));
			expect(logLines.indexOf(secondarySync)).toBeLessThan(logLines.indexOf(forwardedRequest));
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
