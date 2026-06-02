import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAutoUpdatePlan, runAutoUpdateCheck } from "../scripts/auto-update.mjs";

test("#given auto update is disabled #when resolving plan #then no command is scheduled", () => {
	const plan = resolveAutoUpdatePlan({
		env: { LAZYCODEX_AUTO_UPDATE_DISABLED: "1" },
		now: 1_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "disabled");
});

test("#given stale state #when resolving plan #then installer update command is scheduled", () => {
	const plan = resolveAutoUpdatePlan({
		env: {},
		now: 90_000_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, true);
	assert.deepEqual(plan.command, "npx");
	assert.deepEqual(plan.args, ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--skip-auth"]);
});

test("#given recent state #when resolving plan #then update is throttled", () => {
	const plan = resolveAutoUpdatePlan({
		env: {},
		now: 90_000_000,
		lastCheckedAt: 89_999_000,
	});

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "throttled");
});

test("#given test command override #when running check #then records state and launches command", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-"));
	const logPath = join(root, "spawn.log");
	const statePath = join(root, "state.json");
	const codexHome = join(root, "codex-home");

	const result = await runAutoUpdateCheck({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
			LAZYCODEX_AUTO_UPDATE_STATE_PATH: statePath,
			LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
			LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
			LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", `require("node:fs").writeFileSync(${JSON.stringify(logPath)}, "ok")`]),
			LAZYCODEX_AUTO_UPDATE_WAIT: "1",
		},
		now: 123_456,
	});

	assert.equal(result.started, true);
	assert.equal(JSON.parse(await readFile(statePath, "utf8")).lastCheckedAt, 123_456);
	assert.equal(await readFile(logPath, "utf8"), "ok");
	assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /model = "gpt-5\.5"/);
});

test("#given active lock #when running check #then skips concurrent update", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-lock-"));
	const statePath = join(root, "state.json");
	const lockPath = join(root, "state.json.lock");
	const codexHome = join(root, "codex-home");
	await writeFile(lockPath, "locked\n");

	const result = await runAutoUpdateCheck({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
			LAZYCODEX_AUTO_UPDATE_STATE_PATH: statePath,
			LAZYCODEX_AUTO_UPDATE_LOCK_PATH: lockPath,
			LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
			LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS: "600000",
		},
		now: 123_456,
	});

	assert.equal(result.started, false);
	assert.equal(result.reason, "locked");
	assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /model_context_window = 400000/);
});

test("#given throttled updater and stale Codex config #when running check #then config migration still runs", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-migration-"));
	const statePath = join(root, "state.json");
	const codexHome = join(root, "codex-home");
	await writeFile(statePath, JSON.stringify({ lastCheckedAt: 99_999 }, null, 2));
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		[
			'model = "gpt-5.2"',
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
		},
		now: 100_000,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.equal(result.started, false);
	assert.equal(result.reason, "throttled");
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /gpt-5\.2/);
});
