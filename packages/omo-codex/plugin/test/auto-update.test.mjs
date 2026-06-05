import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAutoUpdatePlan, resolveLazyCodexUpdatePlan, runAutoUpdateCheck } from "../scripts/auto-update.mjs";
import { resolveSpawnInvocation } from "../scripts/spawn-command.mjs";

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
		env: { LAZYCODEX_CURRENT_VERSION: "1.0.0", LAZYCODEX_LATEST_VERSION: "1.0.1" },
		now: 90_000_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, true);
	assert.deepEqual(plan.command, "npx");
	assert.deepEqual(plan.args, ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"]);
});

test("#given Windows npm shims #when resolving spawn commands #then cmd shims are used", () => {
	assert.deepEqual(resolveSpawnInvocation("npm", ["install"], "win32"), {
		command: "cmd.exe",
		args: ["/d", "/s", "/c", "npm.cmd", "install"],
	});
	assert.deepEqual(resolveSpawnInvocation("npx", ["--yes", "lazycodex-ai@latest"], "win32"), {
		command: "cmd.exe",
		args: ["/d", "/s", "/c", "npx.cmd", "--yes", "lazycodex-ai@latest"],
	});
	assert.deepEqual(resolveSpawnInvocation("node", ["script.mjs"], "win32"), {
		command: "node",
		args: ["script.mjs"],
	});
	assert.deepEqual(resolveSpawnInvocation("npx", ["--yes"], "darwin"), {
		command: "npx",
		args: ["--yes"],
	});
});

test("#given current version #when resolving update plan #then skips installer", () => {
	const plan = resolveLazyCodexUpdatePlan({
		currentVersion: "1.0.1",
		latestVersion: "1.0.1",
	});

	assert.equal(plan.shouldUpdate, false);
	assert.equal(plan.reason, "up-to-date");
});

test("#given latest version is newer #when resolving update plan #then schedules installer", () => {
	const plan = resolveLazyCodexUpdatePlan({
		currentVersion: "1.0.0",
		latestVersion: "1.0.1",
	});

	assert.equal(plan.shouldUpdate, true);
	assert.deepEqual(plan.command, "npx");
	assert.deepEqual(plan.args, ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"]);
});

test("#given current version is a prerelease of latest #when resolving update plan #then schedules stable installer", () => {
	const plan = resolveLazyCodexUpdatePlan({
		currentVersion: "1.0.1-beta.1",
		latestVersion: "1.0.1",
	});

	assert.equal(plan.shouldUpdate, true);
	assert.deepEqual(plan.args, ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"]);
});

test("#given malformed latest version #when resolving update plan #then fails closed without scheduling", () => {
	const plan = resolveLazyCodexUpdatePlan({
		currentVersion: "1.0.0",
		latestVersion: "latest",
	});

	assert.equal(plan.shouldUpdate, false);
	assert.equal(plan.reason, "unknown-latest");
});

test("#given current version #when resolving auto update plan #then no command is scheduled", () => {
	const plan = resolveAutoUpdatePlan({
		env: { LAZYCODEX_CURRENT_VERSION: "1.0.1", LAZYCODEX_LATEST_VERSION: "1.0.1" },
		now: 90_000_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "up-to-date");
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

test("#given installed lazycodex version snapshot #when resolving auto update plan #then uses distribution version", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-version-"));
	const versionPath = join(root, "lazycodex-install.json");
	await writeFile(versionPath, JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.1" }));

	const plan = resolveAutoUpdatePlan({
		env: {
			LAZYCODEX_INSTALLED_VERSION_PATH: versionPath,
			LAZYCODEX_LATEST_VERSION: "1.0.1",
		},
		now: 90_000_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "up-to-date");
});

test("#given test command override #when running check #then records state and launches command", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-"));
	const logPath = join(root, "spawn.log");
	const env = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", `require("node:fs").writeFileSync(${JSON.stringify(logPath)}, "ok")`]),
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
	});

	const result = await runAutoUpdateCheck({
		env,
		now: 123_456,
	});

	assert.equal(result.started, true);
	assert.deepEqual(JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")), {
		lastCheckedAt: 123_456,
		lastAttemptedAt: 123_456,
		lastStatus: "success",
	});
	assert.equal(await readFile(logPath, "utf8"), "ok");
	const updateLog = (await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(updateLog, [
		{
			timestamp: "1970-01-01T00:02:03.456Z",
			event: "started",
			command: process.execPath,
			args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(logPath)}, "ok")`],
		},
		{
			timestamp: "1970-01-01T00:02:03.456Z",
			event: "finished",
			status: 0,
		},
	]);
	assert.match(await readFile(join(env.CODEX_HOME, "config.toml"), "utf8"), /model = "gpt-5\.5"/);
});

test("#given failed waited update #when retry window passes #then next update is not blocked by success throttle", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-retry-"));
	const successPath = join(root, "success.log");
	const baseEnv = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
	});

	const failed = await runAutoUpdateCheck({
		env: {
			...baseEnv,
			LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", "process.exit(1)"]),
		},
		now: 123_456,
	});
	assert.equal(failed.started, true);
	assert.equal(failed.status, 1);
	assert.deepEqual(JSON.parse(await readFile(baseEnv.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")), {
		lastAttemptedAt: 123_456,
		lastStatus: "failed",
	});

	const retried = await runAutoUpdateCheck({
		env: {
			...baseEnv,
			LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", `require("node:fs").writeFileSync(${JSON.stringify(successPath)}, "ok")`]),
		},
		now: 123_456 + 30 * 60 * 1_000 + 1,
	});

	assert.equal(retried.started, true);
	assert.equal(retried.status, 0);
	assert.equal(await readFile(successPath, "utf8"), "ok");
});

test("#given active lock #when running check #then skips concurrent update", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-lock-"));
	const lockPath = join(root, "state.json.lock");
	await writeFile(lockPath, "locked\n");

	const result = await runAutoUpdateCheck({
		env: autoUpdateEnv(root, {
			LAZYCODEX_AUTO_UPDATE_LOCK_PATH: lockPath,
			LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
			LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS: "600000",
		}),
		now: 123_456,
	});

	assert.equal(result.started, false);
	assert.equal(result.reason, "locked");
	assert.match(await readFile(join(root, "codex-home", "config.toml"), "utf8"), /model_context_window = 400000/);
});

test("#given stale lock #when running check #then removes lock and runs update", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-stale-lock-"));
	const lockPath = join(root, "state.json.lock");
	const successPath = join(root, "success.log");
	await writeFile(lockPath, "locked\n");
	await utimes(lockPath, new Date(0), new Date(0));
	const env = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_LOCK_PATH: lockPath,
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS: "600000",
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", `require("node:fs").writeFileSync(${JSON.stringify(successPath)}, "ok")`]),
	});

	const result = await runAutoUpdateCheck({
		env,
		now: 1_000_000,
	});

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(successPath, "utf8"), "ok");
	assert.deepEqual(JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")), {
		lastCheckedAt: 1_000_000,
		lastAttemptedAt: 1_000_000,
		lastStatus: "success",
	});
});

test("#given throttled updater and stale Codex config #when running check #then config migration still runs", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-migration-"));
	const statePath = join(root, "state.json");
	const updateLogPath = join(root, "auto-update.log");
	const codexHome = join(root, "codex-home");
	await writeFile(statePath, JSON.stringify({ lastCheckedAt: 99_999 }, null, 2));
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
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /gpt-5\.2/);
});
