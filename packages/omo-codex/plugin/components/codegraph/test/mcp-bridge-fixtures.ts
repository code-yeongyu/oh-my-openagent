import { chmodSync, writeFileSync } from "node:fs";

export const CODEGRAPH_141_DEFAULT_TOOLS: readonly Record<string, unknown>[] = [
	{
		name: "codegraph_explore",
		description:
			"PRIMARY TOOL — call FIRST for almost any question OR before an edit: how does X work, architecture, a bug, where/what is X, surveying an area, or the symbols you are about to change. Returns the verbatim source of the relevant symbols grouped by file in ONE capped call (Read-equivalent — treat the shown source as already Read; do NOT re-open those files), plus the call path among them. Query can be a natural-language question OR a bag of symbol/file names. Usually the ONLY call you need — more accurate context, in far fewer tokens and round-trips than a search/Read/Grep loop.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						'Symbol names, file names, or short code terms to explore (e.g., "AuthService loginUser session-manager", "GraphTraverser BFS impact traversal.ts"). For a flow question, name the symbols spanning the flow (e.g. "mutateElement renderScene"). A natural-language question works too — no prior codegraph_search needed.',
				},
				maxFiles: {
					type: "number",
					description: "Maximum number of files to include source code from (default: 12)",
					default: 12,
				},
				projectPath: {
					type: "string",
					description:
						"Absolute path to the project to query (or any directory inside it) — codegraph uses the nearest .codegraph/ index at or above that path. Omit to use this session's default project. Pass it to query a second codebase, or when the server root has no index of its own (e.g. a monorepo where only sub-projects are indexed, so there is no default project).",
				},
			},
			required: ["query"],
		},
	},
];

export function writeFakeNewlineCodegraph(filePath: string): void {
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
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { capabilities: { tools: { listChanged: false } }, protocolVersion: request.params.protocolVersion, serverInfo: { name: 'codegraph', version: '1.4.1' } } }) + '\\n');",
			"  }",
			"  if (request.method === 'tools/list') {",
			`    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: ${JSON.stringify(CODEGRAPH_141_DEFAULT_TOOLS)} } }) + '\\n');`,
			"  }",
			"});",
		].join("\n"),
	);
	chmodSync(filePath, 0o755);
}

export function writeFakeContractCodegraph(filePath: string): void {
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

export function writeFakeHeldOpenCodegraph(filePath: string): void {
	writeFileSync(
		filePath,
		[
			"#!/usr/bin/env node",
			"const fs = require('node:fs');",
			"const readline = require('node:readline');",
			"fs.writeFileSync(process.env.CODEGRAPH_FAKE_LOG, String(process.pid));",
			"const rl = readline.createInterface({ input: process.stdin });",
			"rl.once('line', (line) => {",
			"  const request = JSON.parse(line);",
			"  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } }) + '\\n');",
			"});",
			"setInterval(() => {}, 1000);",
		].join("\n"),
	);
	chmodSync(filePath, 0o755);
}

export function writeFakeExitingCodegraph(filePath: string): void {
	writeFileSync(
		filePath,
		[
			"#!/usr/bin/env node",
			"const readline = require('node:readline');",
			"const rl = readline.createInterface({ input: process.stdin });",
			"rl.once('line', (line) => {",
			"  const request = JSON.parse(line);",
			"  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } }) + '\\n', () => process.exit(0));",
			"});",
		].join("\n"),
	);
	chmodSync(filePath, 0o755);
}

export function frameMcpRequest(request: {
	readonly id: number;
	readonly method: string;
	readonly params: Record<string, unknown>;
}): string {
	const body = JSON.stringify({ jsonrpc: "2.0", ...request });
	return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

export function parseMcpBodies(transcript: string): readonly unknown[] {
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

export function findTool(tools: readonly unknown[], name: string): Record<string, unknown> {
	for (const tool of tools) {
		const record = recordValue(tool);
		if (record["name"] === name) return record;
	}
	throw new Error(`Missing tool ${name}`);
}

export function arrayProperty(record: Record<string, unknown>, key: string): readonly unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new Error(`Expected ${key} to be an array`);
	return value;
}

export function recordProperty(record: Record<string, unknown>, key: string): Record<string, unknown> {
	return recordValue(record[key]);
}

export function stringProperty(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`);
	return value;
}

export function recordValue(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Expected record value");
	}
	return value as Record<string, unknown>;
}
