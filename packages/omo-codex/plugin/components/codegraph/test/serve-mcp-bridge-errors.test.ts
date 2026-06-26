import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runCodegraphServe } from "../src/serve.ts";
import { frameMcpRequest, parseMcpBodies, writeFakeNewlineCodegraph } from "./serve-mcp-test-helpers.ts";

describe("runCodegraphServe MCP protocol bridge errors", () => {
	it("#given secondary refresh fails #when serving a framed tool call #then it returns a framed stale-call error without forwarding", async () => {
		// given
		const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-bridge-refresh-fail-"));
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
					CODEGRAPH_FAIL_SYNC_CWD: realpathSync(secondaryProject),
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
							query: "staleSymbol",
						},
						name: "codegraph_search",
					},
				}),
			].join(""));
			const exitCode = await run;

			// then
			expect(exitCode).toBe(0);
			const bodies = parseMcpBodies(stdout);
			expect(bodies[0]).toEqual({
				id: 1,
				jsonrpc: "2.0",
				result: {
					capabilities: { tools: { listChanged: false } },
					protocolVersion: "2025-06-18",
					serverInfo: { name: "codegraph", version: "1.1.1" },
				},
			});
			const errorBody = JSON.stringify(bodies[1]);
			expect(errorBody).toContain('"jsonrpc":"2.0"');
			expect(errorBody).toContain('"id":2');
			expect(errorBody).toContain('"code":-32001');
			expect(errorBody).toContain("CodeGraph sync failed in ");
			expect(errorBody).toContain("sync blocked");
			const logLines = readFileSync(childLog, "utf8").trim().split("\n");
			expect(logLines.some((line) => line.startsWith("sync-fail:"))).toBe(true);
			expect(logLines).not.toContain(`request:${secondaryProject}:staleSymbol`);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
