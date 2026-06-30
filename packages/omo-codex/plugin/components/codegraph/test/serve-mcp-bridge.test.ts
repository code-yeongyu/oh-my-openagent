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
						serverInfo: { name: "codegraph", version: "1.0.1" },
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
			expect(readFileSync(childLog, "utf8")).toContain(`cwd=${realpathSync(projectRoot)}`);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given old upstream codegraph_node metadata and container outline guidance #when bridging #then it exposes the corrected LazyCodex contract", async () => {
		// given
		const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-contract-"));
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
});

function writeFakeNewlineCodegraph(filePath: string): void {
	writeFileSync(
		filePath,
		[
			"#!/usr/bin/env node",
			"const fs = require('node:fs');",
			"const readline = require('node:readline');",
			"fs.writeFileSync(process.env.CODEGRAPH_FAKE_LOG, `cwd=${process.cwd()}\\n`);",
			"const rl = readline.createInterface({ input: process.stdin });",
			"rl.on('line', (line) => {",
			"  const request = JSON.parse(line);",
			"  if (request.method === 'initialize') {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { capabilities: { tools: { listChanged: false } }, protocolVersion: request.params.protocolVersion, serverInfo: { name: 'codegraph', version: '1.0.1' } } }) + '\\n');",
			"  }",
			"  if (request.method === 'tools/list') {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'codegraph_search' }, { name: 'codegraph_node' }, { name: 'codegraph_explore' }, { name: 'codegraph_callers' }] } }) + '\\n');",
			"  }",
			"});",
		].join("\n"),
	);
	chmodSync(filePath, 0o755);
}

function writeFakeContractCodegraph(filePath: string): void {
	writeFileSync(
		filePath,
		[
			"#!/usr/bin/env node",
			"const fs = require('node:fs');",
			"const readline = require('node:readline');",
			"fs.writeFileSync(process.env.CODEGRAPH_FAKE_LOG, `cwd=${process.cwd()}\\n`);",
			"const rl = readline.createInterface({ input: process.stdin });",
			"rl.on('line', (line) => {",
			"  const request = JSON.parse(line);",
			"  if (request.method === 'tools/list') {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [",
			"      { name: 'codegraph_search', description: 'search stays unchanged' },",
			"      { name: 'codegraph_node', description: 'ONE SYMBOL you can name - its location, signature, verbatim source (includeCode=true) and caller/callee trail in one call', inputSchema: { type: 'object', properties: { includeCode: { type: 'boolean', description: \"Symbol mode: include the symbol's full body (default: false).\" }, symbol: { type: 'string' } } } }",
			"    ] } }) + '\\n');",
			"  }",
			"  if (request.method === 'tools/call') {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'JsonlMCP\\nMembers (7)\\nStructural outline only. For full source, use the Read tool on this file or request a member.' }] } }) + '\\n');",
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

function findTool(tools: readonly unknown[], name: string): Record<string, unknown> {
	for (const tool of tools) {
		const record = recordValue(tool);
		if (record["name"] === name) return record;
	}
	throw new Error(`Missing tool ${name}`);
}

function arrayProperty(record: Record<string, unknown>, key: string): readonly unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new Error(`Expected ${key} to be an array`);
	return value;
}

function recordProperty(record: Record<string, unknown>, key: string): Record<string, unknown> {
	return recordValue(record[key]);
}

function stringProperty(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`);
	return value;
}

function recordValue(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Expected record value");
	}
	return value as Record<string, unknown>;
}
