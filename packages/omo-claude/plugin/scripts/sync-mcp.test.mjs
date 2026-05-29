import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	AST_GREP_DEST,
	LSP_COMPONENT_HOOK,
	LSP_DEST,
	MCP_JSON_PATH,
	checkVendored,
	syncMcp,
} from "./sync-mcp.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(SCRIPT_DIR, "sync-mcp.mjs");

// Self-contained: build + vendor + bundle so these assertions never depend on
// prior build state or test ordering (sync-components.test re-syncs the lsp
// component and wipes its dist; this rebuilds it before we check).
before(async () => {
	await syncMcp({ build: true });
});

function runCli(args) {
	return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf8" });
}

test("--check is GREEN against the vendored tree", () => {
	const check = runCli(["--check"]);
	assert.equal(check.status, 0, `--check should be green but got: ${check.stderr}`);
	assert.match(check.stdout, /in sync/);
});

test("checkVendored reports no problems", async () => {
	const problems = await checkVendored();
	assert.deepEqual(problems, [], `unexpected vendoring problems: ${problems.join("; ")}`);
});

test(".mcp.json is self-contained (no ../, uses ${CLAUDE_PLUGIN_ROOT}, no cwd)", async () => {
	const raw = await readFile(MCP_JSON_PATH, "utf8");
	assert.ok(!raw.includes("../"), ".mcp.json must not contain '../' paths");
	assert.ok(raw.includes("${CLAUDE_PLUGIN_ROOT}"), ".mcp.json must reference ${CLAUDE_PLUGIN_ROOT}");
	assert.ok(!raw.includes('"cwd"'), '.mcp.json must not declare a "cwd"');

	const parsed = JSON.parse(raw);
	assert.ok(parsed.mcpServers.ast_grep, "ast_grep server present");
	assert.ok(parsed.mcpServers.lsp, "lsp server present");
	assert.deepEqual(parsed.mcpServers.ast_grep.args, [
		"${CLAUDE_PLUGIN_ROOT}/mcp/ast-grep/cli.js",
		"mcp",
	]);
	assert.deepEqual(parsed.mcpServers.lsp.args, ["${CLAUDE_PLUGIN_ROOT}/mcp/lsp/cli.js", "mcp"]);
});

test("vendored server entrypoints exist", async () => {
	for (const f of [join(AST_GREP_DEST, "cli.js"), join(LSP_DEST, "cli.js")]) {
		const raw = await readFile(f, "utf8");
		assert.ok(raw.length > 0, `${f} should be non-empty`);
	}
});

test("lsp component hook is bundled (no unbundled @code-yeongyu/lsp-tools-mcp import)", async () => {
	const hook = await readFile(LSP_COMPONENT_HOOK, "utf8");
	// A guarded require.resolve(...) fallback is allowed. An actual import/require
	// statement is not (it would fail to resolve from a node_modules-free cache).
	const unbundledImport =
		/\bfrom\s*["'][^"']*@code-yeongyu\/lsp-tools-mcp|\brequire\s*\(\s*["'][^"']*@code-yeongyu\/lsp-tools-mcp/;
	assert.ok(
		!unbundledImport.test(hook),
		"the lsp component hook must inline lsp-tools-mcp so it resolves from a cache",
	);
});
