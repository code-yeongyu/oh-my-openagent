import { chmodSync, writeFileSync } from "node:fs";

export function writeFakeNewlineCodegraph(filePath: string): void {
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
