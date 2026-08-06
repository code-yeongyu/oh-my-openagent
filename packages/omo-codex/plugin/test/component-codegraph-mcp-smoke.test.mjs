import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

const MCP_SMOKE_TIMEOUT_MS = 45_000;

test("#given built CodeGraph MCP wrapper #when an MCP client initializes #then the resolved child responds over stdio", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-codegraph-mcp-smoke-"));
	try {
		const fakeBinaryPath = join(tempRoot, "codegraph-fake.cjs");
		writeFileSync(
			fakeBinaryPath,
			[
				"#!/usr/bin/env node",
				"const readline = require('node:readline');",
				"const rl = readline.createInterface({ input: process.stdin });",
				"rl.on('line', (line) => {",
				"  const request = JSON.parse(line);",
				"  if (request.method !== 'initialize') return;",
				"  process.stdout.write(JSON.stringify({",
				"    jsonrpc: '2.0',",
				"    id: request.id,",
				"    result: {",
				"      protocolVersion: request.params?.protocolVersion ?? '2024-11-05',",
				"      capabilities: { tools: { listChanged: false } },",
				"      serverInfo: { name: 'fake-codegraph', version: '0.0.0' }",
				"    }",
				"  }) + '\\n');",
				"});",
				"",
			].join("\n"),
		);
		chmodSync(fakeBinaryPath, 0o755);

		const result = spawnSync(process.execPath, [join(root, "components", "codegraph", "dist", "serve.js")], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				HOME: tempRoot,
				OMO_CODEGRAPH_BIN: fakeBinaryPath,
			},
			input: `${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					capabilities: {},
					clientInfo: { name: "lazycodex-smoke", version: "0.0.0" },
					protocolVersion: "2024-11-05",
				},
			})}\n`,
			timeout: MCP_SMOKE_TIMEOUT_MS,
		});

		assert.equal(result.status, 0, `stderr: ${result.stderr}`);
		assert.equal(result.stderr, "");
		const response = JSON.parse(result.stdout.trim());
		assert.deepEqual(response, {
			jsonrpc: "2.0",
			id: 1,
			result: {
				capabilities: { tools: { listChanged: false } },
				protocolVersion: "2024-11-05",
				serverInfo: { name: "fake-codegraph", version: "0.0.0" },
			},
		});
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
