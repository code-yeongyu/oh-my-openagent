import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HANDLED_COMPONENTS, PATCH_MANIFEST, syncComponents } from "./sync-components.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(SCRIPT_DIR, "sync-components.mjs");
const PLUGIN_ROOT = dirname(SCRIPT_DIR);
const DRIFT_FILE = join(PLUGIN_ROOT, "components", "lsp", "src", "codex-hook.ts");

function runCli(args) {
	return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf8" });
}

test("sync then --check is GREEN (exit 0)", () => {
	const sync = runCli([]);
	assert.equal(sync.status, 0, `sync failed: ${sync.stderr}`);

	const check = runCli(["--check"]);
	assert.equal(check.status, 0, `--check should be green after sync but got: ${check.stderr}`);
	assert.match(check.stdout, /in sync/);
});

test("--check is RED (nonzero) after hand-drift, then re-sync restores GREEN", async () => {
	runCli([]);

	const original = await readFile(DRIFT_FILE, "utf8");
	try {
		await writeFile(DRIFT_FILE, `${original}\n// drift\n`);
		const drifted = runCli(["--check"]);
		assert.notEqual(drifted.status, 0, "--check must fail after hand-drift");
		assert.match(drifted.stderr, /out of sync/);
		assert.match(drifted.stderr, /lsp\/src\/codex-hook\.ts/);
	} finally {
		// Re-sync to restore the vendored tree regardless of assertion outcome.
		const restore = runCli([]);
		assert.equal(restore.status, 0, `restore sync failed: ${restore.stderr}`);
	}

	const check = runCli(["--check"]);
	assert.equal(check.status, 0, `--check should be green again after re-sync: ${check.stderr}`);
});

test("sync is idempotent (running twice yields no drift)", () => {
	assert.equal(runCli([]).status, 0);
	assert.equal(runCli([]).status, 0);
	assert.equal(runCli(["--check"]).status, 0);
});

test("a single component can be synced and check passes", () => {
	const sync = runCli(["rules"]);
	assert.equal(sync.status, 0, sync.stderr);
	assert.match(sync.stdout, /rules/);
	// Re-sync all so the rest of the suite/state is whole.
	assert.equal(runCli([]).status, 0);
	assert.equal(runCli(["--check"]).status, 0);
});

test("unknown component is rejected", () => {
	const result = runCli(["does-not-exist"]);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /unknown component/);
});

test("every required replacement in the manifest matches the source", async () => {
	const matched = [];
	await syncComponents({ check: true, components: HANDLED_COMPONENTS });
	// syncComponents records matches via its internal collector; re-derive by
	// running a check pass and asserting no required replacement is unmatched.
	const result = await syncComponents({ check: true });
	for (const entry of result.matched) {
		if (entry.required) {
			assert.equal(
				entry.matched,
				true,
				`required replacement did not match: ${entry.component}/${entry.file} :: ${entry.find}`,
			);
		}
	}
	assert.ok(result.matched.length >= PATCH_MANIFEST.length, "expected manifest replacements to be exercised");
	// matched local kept for clarity; not otherwise used.
	void matched;
});
