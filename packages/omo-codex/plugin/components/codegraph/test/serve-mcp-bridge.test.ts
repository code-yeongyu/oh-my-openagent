import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runCodegraphServe } from "../src/serve.ts";

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

function writeFakeNewlineCodegraph(filePath: string): void {
	writeFileSync(
		filePath,
		[
			"#!/usr/bin/env node",
			"const fs = require('node:fs');",
			"const readline = require('node:readline');",
			"const log = process.env.CODEGRAPH_FAKE_LOG;",
			"const append = (line) => fs.appendFileSync(log, `${line}\\n`);",
			"if (process.argv[2] === 'status') {",
			"  append(`status:${process.cwd()}`);",
			"  process.stdout.write('{\"initialized\":true}\\n');",
			"  process.exit(0);",
			"}",
			"if (process.argv[2] === 'sync') {",
			"  if (process.cwd() === process.env.CODEGRAPH_FAIL_SYNC_CWD) {",
			"    append(`sync-fail:${process.cwd()}`);",
			"    process.stderr.write('sync blocked\\n');",
			"    process.exit(1);",
			"  }",
			"  append(`sync:${process.cwd()}`);",
			"  process.exit(0);",
			"}",
			"append(`serve:${process.cwd()}`);",
			"const rl = readline.createInterface({ input: process.stdin });",
			"rl.on('line', (line) => {",
			"  const request = JSON.parse(line);",
			"  if (request.method === 'initialize') {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { capabilities: { tools: { listChanged: false } }, protocolVersion: request.params.protocolVersion, serverInfo: { name: 'codegraph', version: '1.1.1' } } }) + '\\n');",
			"  }",
			"  if (request.method === 'tools/list') {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'codegraph_search' }, { name: 'codegraph_node' }, { name: 'codegraph_explore' }, { name: 'codegraph_callers' }] } }) + '\\n');",
			"  }",
			"  if (request.method === 'tools/call') {",
			"    append(`request:${request.params.arguments.projectPath}:${request.params.arguments.query}`);",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'fresh secondary result' }] } }) + '\\n');",
			"  }",
			"});",
		].join("\n"),
	);
	chmodSync(filePath, 0o755);
}
function frameMcpRequest(request: {
	readonly id: number;
	readonly method: string;
	readonly params: Record<string, unknown>;
}): string {
	const body = JSON.stringify({ jsonrpc: "2.0", ...request });
	return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function parseMcpBodies(transcript: string): readonly unknown[] {
	const bodies: unknown[] = [];
	let cursor = 0;
	while (cursor < transcript.length) {
		const headerEnd = transcript.indexOf("\r\n\r\n", cursor);
		if (headerEnd === -1) break;
		const header = transcript.slice(cursor, headerEnd);
		const match = /^Content-Length: (?<length>\d+)$/m.exec(header);
		if (match?.groups?.["length"] === undefined) break;
		const length = Number.parseInt(match.groups["length"], 10);
		const bodyStart = headerEnd + 4;
		const body = transcript.slice(bodyStart, bodyStart + length);
		bodies.push(JSON.parse(body));
		cursor = bodyStart + length;
	}
	return bodies;
}
