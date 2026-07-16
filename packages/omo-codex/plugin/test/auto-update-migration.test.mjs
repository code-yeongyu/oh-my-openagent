import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAutoUpdateCheck } from "../scripts/auto-update.mjs";

test("#given throttled updater and stale Codex config #when running check #then config migration still runs", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-auto-update-migration-"),
	);
	const statePath = join(root, "state.json");
	const updateLogPath = join(root, "auto-update.log");
	const codexHome = join(root, "codex-home");
	await writeFile(
		statePath,
		JSON.stringify({ lastCheckedAt: 99_999 }, null, 2),
	);
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		[
			'model = "gpt-5.5"',
			"model_context_window = 272000",
			'model_reasoning_effort = "low"',
			'plan_mode_reasoning_effort = "medium"',
			"",
			"[features]",
			"plugins = true",
			"",
		].join("\n"),
	);

	const result = await runAutoUpdateCheck({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
			LAZYCODEX_AUTO_UPDATE_STATE_PATH: statePath,
			LAZYCODEX_AUTO_UPDATE_LOG_PATH: updateLogPath,
		},
		now: 100_000,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.equal(result.started, false);
	assert.equal(result.reason, "throttled");
	assert.match(content, /model = "gpt-5\.6-sol"/);
	assert.match(content, /model_context_window = 372000/);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /gpt-5\.2/);
});

test("#given throttled updater and no OMO SOT #when running check #then OMO SOT seed migration still runs", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-omo-sot-"));
	const statePath = join(root, "state.json");
	const home = join(root, "home");
	await writeFile(
		statePath,
		JSON.stringify({ lastCheckedAt: 99_999 }, null, 2),
	);
	await mkdir(join(root, "codex-home"), { recursive: true });

	const result = await runAutoUpdateCheck({
		env: {
			CODEX_HOME: join(root, "codex-home"),
			HOME: home,
			CODEX_CODEGRAPH_ENABLED: "0",
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
			LAZYCODEX_AUTO_UPDATE_STATE_PATH: statePath,
			LAZYCODEX_AUTO_UPDATE_LOG_PATH: join(root, "auto-update.log"),
		},
		now: 100_000,
	});

	const content = await readFile(join(home, ".omo", "config.jsonc"), "utf8");
	assert.equal(result.started, false);
	assert.equal(result.reason, "throttled");
	assert.match(content, /"\[codex\]"/);
	assert.match(content, /"\[opencode\]"/);
});
