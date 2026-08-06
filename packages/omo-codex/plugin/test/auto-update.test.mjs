import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { readSessionModelFromStdin, resolveAutoUpdatePlan, resolveLazyCodexUpdatePlan, runAutoUpdateCheck } from "../scripts/auto-update.mjs";
import { detectInstallFlow } from "../scripts/install-flow.mjs";
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

function stdinFrom(payload) {
	const stream = new PassThrough();
	stream.end(payload);
	return stream;
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

test("#given SessionStart payload with model #when reading stdin #then returns the model", async () => {
	const payload = JSON.stringify({
		hook_event_name: "SessionStart",
		session_id: "s-1",
		cwd: "/tmp",
		model: "gpt-5.6-terra",
		permission_mode: "default",
		source: "startup",
	});

	assert.equal(await readSessionModelFromStdin(stdinFrom(payload)), "gpt-5.6-terra");
});

test("#given empty or malformed stdin #when reading session model #then returns null", async () => {
	assert.equal(await readSessionModelFromStdin(stdinFrom("")), null);
	assert.equal(await readSessionModelFromStdin(stdinFrom("not json")), null);
	assert.equal(await readSessionModelFromStdin(stdinFrom(JSON.stringify({ model: "  " }))), null);
	assert.equal(await readSessionModelFromStdin(stdinFrom(JSON.stringify({ session_id: "s-1" }))), null);
	assert.equal(await readSessionModelFromStdin(null), null);
});

test("#given a TTY stdin #when reading session model #then returns null without waiting", async () => {
	const stream = stdinFrom("{}");
	stream.isTTY = true;
	assert.equal(await readSessionModelFromStdin(stream), null);
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
		pendingNotice: {
			fromVersion: "1.0.0",
			toVersion: "1.0.1",
			startedAt: 123_456,
		},
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
		{
			timestamp: "1970-01-01T00:02:03.456Z",
			event: "notified",
			kind: "update-started",
			fromVersion: "1.0.0",
			toVersion: "1.0.1",
		},
	]);
	assert.match(await readFile(join(env.CODEX_HOME, "config.toml"), "utf8"), /model = "gpt-5\.6-sol"/);
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
	assert.match(await readFile(join(root, "codex-home", "config.toml"), "utf8"), /model_context_window = 372000/);
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
		pendingNotice: {
			fromVersion: "1.0.0",
			toVersion: "1.0.1",
			startedAt: 1_000_000,
		},
	});
});

async function makeStorePluginRoot(prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	const pluginRoot = join(root, "store", "omo", "1.0.0");
	await mkdir(pluginRoot, { recursive: true });
	return { root, pluginRoot };
}

function marketplaceCheckEnv(root, pluginRoot, spawnLogPath, extra = {}) {
	return autoUpdateEnv(root, {
		PLUGIN_ROOT: pluginRoot,
		LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", `require("node:fs").writeFileSync(${JSON.stringify(spawnLogPath)}, "ok")`]),
		...extra,
	});
}

test("#given marketplace plugin root without install snapshot #when running check #then skips npx update with marketplace-flow log and upgrade notice", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-marketplace-"));
	const codexHome = join(root, "codex-home");
	const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.0");
	const spawnLogPath = join(root, "spawn.log");
	await mkdir(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"), { recursive: true });
	await mkdir(pluginRoot, { recursive: true });
	await writeFile(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: { source: "local", path: "./omo/1.0.0" } }],
		}),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, { CODEX_HOME: codexHome });

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, false);
	assert.equal(result.reason, "marketplace-flow");
	assert.equal(result.notices.length, 1);
	assert.match(result.notices[0], /codex plugin marketplace upgrade sisyphuslabs/);
	assert.match(result.notices[0], /hook re-approval/);
	await assert.rejects(readFile(spawnLogPath, "utf8"), { code: "ENOENT" });
	const state = JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8"));
	assert.equal(state.lastCheckedAt, 123_456);
	assert.equal(state.lastStatus, "success");
	assert.notEqual(state.lastStatus, "started");
	const logEntries = (await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(logEntries, [
		{
			timestamp: "1970-01-01T00:02:03.456Z",
			event: "skipped",
			kind: "marketplace-flow",
		},
	]);
});

test("#given marketplace flow with stale local cache state #when running check #then starts npx repair instead of marketplace skip", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-marketplace-repair-");
	const spawnLogPath = join(root, "spawn.log");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex-home");
	const missingCachedCli = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.1", "components", "ulw-loop", "dist", "cli.js");
	await mkdir(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeFile(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: { source: "local", path: "./omo/1.0.1" } }],
		}),
	);
	await symlink(missingCachedCli, join(binDir, "ulw"));
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		CODEX_LOCAL_BIN_DIR: binDir,
	});

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(spawnLogPath, "utf8"), "ok");
	assert.equal(result.notices.length, 1);
	assert.match(result.notices[0], /repair/i);
	assert.match(result.notices[0], /stale local LazyCodex cache/i);
	assert.match(result.notices[0], /bundled reinstall repair/);
	assert.doesNotMatch(result.notices[0], /Repair command/);
	assert.doesNotMatch(result.notices[0], /plugins[\\/]+cache[\\/]+sisyphuslabs/);
	const logEntries = (await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(logEntries[0].event, "started");
	assert.equal(logEntries[0].kind, "marketplace-local-repair");
	assert.equal(logEntries[0].command, undefined);
	assert.equal(logEntries[0].args, undefined);
	assert.deepEqual(logEntries[0].repairReasons, [
		{ kind: "missing-marketplace-payload" },
		{ kind: "dangling-managed-bin", binName: "ulw" },
	]);
});

test("#given stale marketplace cache and recent success state #when resolving plan #then repair bypasses success throttle", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-marketplace-repair-throttle-");
	const spawnLogPath = join(root, "spawn.log");
	const codexHome = join(root, "codex-home");
	await mkdir(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"), { recursive: true });
	await writeFile(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: { source: "local", path: "./omo/1.0.1" } }],
		}),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});

	const plan = resolveAutoUpdatePlan({ env, now: 123_457, lastCheckedAt: 123_456, lastStatus: "success" });

	assert.equal(plan.shouldRun, true);
	assert.equal(plan.kind, "marketplace-local-repair");
	assert.deepEqual(plan.repairReasons, [{ kind: "missing-marketplace-payload" }]);
});

test("#given stale marketplace cache and recent started state #when resolving plan #then repair honors retry throttle", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-marketplace-repair-retry-");
	const spawnLogPath = join(root, "spawn.log");
	const codexHome = join(root, "codex-home");
	await mkdir(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"), { recursive: true });
	await writeFile(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: { source: "local", path: "./omo/1.0.1" } }],
		}),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});

	const plan = resolveAutoUpdatePlan({ env, now: 123_457, lastAttemptedAt: 123_456, lastStatus: "started" });

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "retry-throttled");
});

test("#given marketplace flow with stale Windows generated shim #when resolving plan #then starts local repair", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-marketplace-windows-repair-");
	const spawnLogPath = join(root, "spawn.log");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex-home");
	const missingCachedCli = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.1", "components", "ulw-loop", "dist", "cli.js");
	await mkdir(binDir, { recursive: true });
	await writeFile(
		join(binDir, "omo-ulw-loop.cmd"),
		[
			"@echo off",
			":: generated by oh-my-openagent Codex installer",
			`\"${missingCachedCli}\" %*`,
			"",
		].join("\r\n"),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		CODEX_LOCAL_BIN_DIR: binDir,
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});

	const plan = resolveAutoUpdatePlan({ env, now: 123_456 });

	assert.equal(plan.shouldRun, true);
	assert.equal(plan.kind, "marketplace-local-repair");
	assert.deepEqual(plan.repairReasons, [{ kind: "dangling-managed-bin", binName: "omo-ulw-loop" }]);
});

test("#given marketplace flow with non-managed stale cache-shaped bin #when resolving plan #then skips local repair", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-marketplace-user-bin-");
	const spawnLogPath = join(root, "spawn.log");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex-home");
	const missingCachedCli = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.1", "components", "ulw-loop", "dist", "cli.js");
	await mkdir(binDir, { recursive: true });
	await symlink(missingCachedCli, join(binDir, "user-tool"));
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		CODEX_LOCAL_BIN_DIR: binDir,
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});

	const plan = resolveAutoUpdatePlan({ env, now: 123_456 });

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "marketplace-flow");
});

test("#given install snapshot at plugin root #when running check #then npx update behavior is unchanged", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-npx-snapshot-");
	await writeFile(join(pluginRoot, "lazycodex-install.json"), JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.0" }));
	const spawnLogPath = join(root, "spawn.log");
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath);

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(spawnLogPath, "utf8"), "ok");
	assert.equal(result.notices.length, 1);
	assert.match(result.notices[0], /Auto-update started in the background/);
	assert.doesNotMatch(result.notices[0], /marketplace upgrade/);
});

test("#given marketplace skip already recorded #when next session is within interval #then throttled without repeated notice", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-marketplace-throttle-");
	const spawnLogPath = join(root, "spawn.log");
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "",
	});

	const first = await runAutoUpdateCheck({ env, now: 123_456 });
	const second = await runAutoUpdateCheck({ env, now: 123_457 });

	assert.equal(first.reason, "marketplace-flow");
	assert.equal(first.notices.length, 1);
	assert.equal(second.started, false);
	assert.equal(second.reason, "throttled");
	assert.deepEqual(second.notices, []);
});

test("#given unreadable install snapshot #when running check #then conservatively keeps npx flow and logs unknown detection", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-auto-update-unknown-flow-");
	await mkdir(join(pluginRoot, "lazycodex-install.json"));
	const spawnLogPath = join(root, "spawn.log");
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath);

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(spawnLogPath, "utf8"), "ok");
	const logEntries = (await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(logEntries[0].event, "install-flow-unknown");
	assert.match(logEntries[0].reason, /install-snapshot/);
});

test("#given install flow fixtures #when detecting install flow #then discriminates on the install snapshot", async () => {
	const { pluginRoot } = await makeStorePluginRoot("lazycodex-install-flow-detect-");

	assert.deepEqual(detectInstallFlow({ pluginRoot }), {
		flow: "marketplace",
		reason: "install-snapshot-absent",
	});

	await writeFile(join(pluginRoot, "lazycodex-install.json"), JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.0" }));
	assert.deepEqual(detectInstallFlow({ pluginRoot }), {
		flow: "npx-local",
		reason: "install-snapshot-present",
	});
});

test("#given workspace tree without install snapshot #when detecting install flow #then stays npx-local", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-install-flow-workspace-"));
	const pluginRoot = join(root, "packages", "omo-codex", "plugin");
	await mkdir(pluginRoot, { recursive: true });
	await writeFile(join(root, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "4.9.2" }));

	assert.deepEqual(detectInstallFlow({ pluginRoot }), {
		flow: "npx-local",
		reason: "workspace-tree",
	});
});

test("#given snapshot path that is not a regular file #when detecting install flow #then reports unknown", async () => {
	const { pluginRoot } = await makeStorePluginRoot("lazycodex-install-flow-unknown-");
	await mkdir(join(pluginRoot, "lazycodex-install.json"));

	const detected = detectInstallFlow({ pluginRoot });

	assert.equal(detected.flow, "unknown");
	assert.match(detected.reason, /install-snapshot/);
});

test("#given LAZYCODEX_INSTALLED_VERSION_PATH override #when detecting install flow #then honors the override path", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot("lazycodex-install-flow-override-");
	const overridePath = join(root, "elsewhere", "lazycodex-install.json");
	await mkdir(join(root, "elsewhere"), { recursive: true });
	await writeFile(overridePath, JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.0" }));

	assert.deepEqual(detectInstallFlow({ pluginRoot, env: { LAZYCODEX_INSTALLED_VERSION_PATH: overridePath } }), {
		flow: "npx-local",
		reason: "install-snapshot-present",
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
	await writeFile(statePath, JSON.stringify({ lastCheckedAt: 99_999 }, null, 2));
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
