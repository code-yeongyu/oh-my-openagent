import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("built CodeGraph serve wrappers", () => {
	it("#given built serve entry #when invoked with a fake CodeGraph binary #then it runs serve mcp exactly once", () => {
		// given
		const tempRoot = createFakeCodegraphRoot();
		try {
			// when
			const result = runBuiltWrapper("dist/serve.js", tempRoot);

			// then
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			expect(readInvocations(tempRoot)).toEqual(['["serve","--mcp"]']);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given built cli entry #when invoked with a fake CodeGraph binary #then it runs serve mcp exactly once", () => {
		// given
		const tempRoot = createFakeCodegraphRoot();
		try {
			// when
			const result = runBuiltWrapper("dist/cli.js", tempRoot);

			// then
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			expect(readInvocations(tempRoot)).toEqual(['["serve","--mcp"]']);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});

function createFakeCodegraphRoot(): string {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-wrapper-"));
	const fakeBinaryPath = join(tempRoot, "codegraph-fake.cjs");
	writeFileSync(
		fakeBinaryPath,
		[
			"#!/usr/bin/env node",
			"const fs = require('node:fs');",
			"fs.appendFileSync(process.env.CODEGRAPH_FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
			"",
		].join("\n"),
	);
	chmodSync(fakeBinaryPath, 0o755);
	return tempRoot;
}

function runBuiltWrapper(entryPath: string, tempRoot: string): ReturnType<typeof spawnSync> {
	return spawnSync(process.execPath, [join(componentRoot, entryPath)], {
		cwd: componentRoot,
		encoding: "utf8",
		env: {
			...process.env,
			CODEGRAPH_ALLOW_UNSAFE_NODE: "1",
			CODEGRAPH_FAKE_LOG: join(tempRoot, "invocations.log"),
			OMO_CODEGRAPH_BIN: join(tempRoot, "codegraph-fake.cjs"),
		},
		timeout: 5000,
	});
}

function readInvocations(tempRoot: string): readonly string[] {
	return readFileSync(join(tempRoot, "invocations.log"), "utf8").trim().split("\n");
}
