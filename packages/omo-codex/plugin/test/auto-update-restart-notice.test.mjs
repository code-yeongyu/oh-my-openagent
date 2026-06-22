import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveAutoUpdatePlan, runAutoUpdateCheck } from "../scripts/auto-update.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/auto-update.mjs", import.meta.url));
const COMPLETED_NOTICE =
	"[LazyCodex] Auto-update completed: v1.0.0 -> v1.0.1. This session is already running the new version. Tell the user the auto-update was applied.";

function autoUpdateEnv(root, extra = {}) {
	return {
		CODEX_HOME: join(root, "codex-home"),
		LAZYCODEX_CURRENT_VERSION: "1.0.0",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
		LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		LAZYCODEX_AUTO_UPDATE_STATE_PATH: join(root, "state.json"),
		LAZYCODEX_AUTO_UPDATE_LOG_PATH: join(root, "auto-update.log"),
		...extra,
	};
}

function assertStartedNotice(notices) {
	assert.equal(notices.length, 1);
	const [notice] = notices;
	assert.equal(typeof notice, "string");
	assert.match(notice, /v1\.0\.0 -> v1\.0\.1/);
	assert.match(notice, /Auto-update started in the background/i);
	assert.match(notice, /new Codex session after it completes/i);
	assert.match(notice, /user's preferred tone/i);
	assert.match(notice, /Release notes for v1\.0\.1 were not available/);
}

test("#given a newer version #when resolving auto update plan #then plan carries current and latest versions", () => {
	const plan = resolveAutoUpdatePlan({
		env: { LAZYCODEX_CURRENT_VERSION: "1.0.0", LAZYCODEX_LATEST_VERSION: "1.0.1" },
		now: 90_000_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, true);
	assert.equal(plan.currentVersion, "1.0.0");
	assert.equal(plan.latestVersion, "1.0.1");
});

test("#given a newer version #when waited update succeeds #then returns update-started notice and persists pendingNotice", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-restart-notice-started-"));
	const env = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", "process.exit(0)"]),
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
	});

	const result = await runAutoUpdateCheck({
		env,
		now: 123_456,
	});

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assertStartedNotice(result.notices);
	const state = JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8"));
	assert.deepEqual(state.pendingNotice, {
		fromVersion: "1.0.0",
		toVersion: "1.0.1",
		startedAt: 123_456,
	});
});

test("#given completed pending update #when startup check is throttled #then emits completed notice and clears pendingNotice", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-restart-notice-completed-"));
	const now = 90_000_000;
	const env = autoUpdateEnv(root, {
		LAZYCODEX_CURRENT_VERSION: "1.0.1",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});
	await writeFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, JSON.stringify({
		lastCheckedAt: now - 1_000,
		lastStatus: "success",
		pendingNotice: { fromVersion: "1.0.0", toVersion: "1.0.1", startedAt: 1 },
	}));

	const result = await runAutoUpdateCheck({
		env,
		now,
	});

	assert.equal(result.started, false);
	assert.equal(result.reason, "throttled");
	assert.deepEqual(result.notices, [COMPLETED_NOTICE]);
	assert.deepEqual(JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")), {
		lastCheckedAt: now - 1_000,
		lastStatus: "success",
	});
});

test("#given incomplete pending update #when startup check runs #then no notice and pendingNotice retained", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-restart-notice-incomplete-"));
	const now = 90_000_000;
	const env = autoUpdateEnv(root);
	await writeFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, JSON.stringify({
		lastAttemptedAt: now - 60_000,
		lastStatus: "started",
		pendingNotice: { fromVersion: "1.0.0", toVersion: "1.0.1", startedAt: 1 },
	}));

	const result = await runAutoUpdateCheck({
		env,
		now,
	});

	assert.equal(result.started, false);
	assert.equal(result.reason, "retry-throttled");
	assert.deepEqual(result.notices, []);
	const state = JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8"));
	assert.deepEqual(state.pendingNotice, {
		fromVersion: "1.0.0",
		toVersion: "1.0.1",
		startedAt: 1,
	});
});

test("#given waited update fails #then no notice and no pendingNotice", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-restart-notice-failed-"));
	const env = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", "process.exit(1)"]),
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
	});

	const result = await runAutoUpdateCheck({
		env,
		now: 123_456,
	});

	assert.equal(result.started, true);
	assert.equal(result.status, 1);
	assert.deepEqual(result.notices, []);
	assert.deepEqual(JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")), {
		lastAttemptedAt: 123_456,
		lastStatus: "failed",
	});
});

test("#given malformed pendingNotice toVersion #when check runs #then pendingNotice dropped silently", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-restart-notice-malformed-"));
	const env = autoUpdateEnv(root, {
		LAZYCODEX_CURRENT_VERSION: "1.0.1",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});
	await writeFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, JSON.stringify({
		pendingNotice: { fromVersion: "1.0.0", toVersion: "not-a-version", startedAt: 1 },
	}));

	const result = await runAutoUpdateCheck({
		env,
		now: 123_456,
	});

	assert.deepEqual(result.notices, []);
	const state = JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8"));
	assert.equal("pendingNotice" in state, false);
});

test("#given completed pending update #when hook session-start runs as CLI #then prints one SessionStart JSON line", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-restart-notice-cli-"));
	const env = autoUpdateEnv(root, {
		LAZYCODEX_CURRENT_VERSION: "1.0.1",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
		LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
	});
	await writeFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, JSON.stringify({
		lastCheckedAt: Date.now() - 1_000,
		lastStatus: "success",
		pendingNotice: { fromVersion: "1.0.0", toVersion: "1.0.1", startedAt: 1 },
	}));

	const result = spawnSync(process.execPath, [SCRIPT_PATH, "hook", "session-start"], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});

	assert.equal(result.status, 0);
	const lines = result.stdout.split("\n").filter((line) => line.length > 0);
	assert.equal(lines.length, 1);
	const parsed = JSON.parse(lines[0]);
	assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
	assert.match(parsed.hookSpecificOutput.additionalContext, /v1\.0\.0 -> v1\.0\.1/);

	const repeat = spawnSync(process.execPath, [SCRIPT_PATH, "hook", "session-start"], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});

	assert.equal(repeat.status, 0);
	assert.equal(repeat.stdout, "");
});
