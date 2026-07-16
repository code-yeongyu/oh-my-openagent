import assert from "node:assert/strict";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAutoUpdateCheck } from "../scripts/auto-update.mjs";
import { autoUpdateEnv } from "./auto-update-test-fixture.mjs";

test("#given test command override #when running check #then records state and launches command", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-"));
	const logPath = join(root, "spawn.log");
	const env = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify([
			"-e",
			`require("node:fs").writeFileSync(${JSON.stringify(logPath)}, "ok")`,
		]),
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
	});

	const result = await runAutoUpdateCheck({
		env,
		now: 123_456,
	});

	assert.equal(result.started, true);
	assert.deepEqual(
		JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")),
		{
			lastCheckedAt: 123_456,
			lastAttemptedAt: 123_456,
			lastStatus: "success",
			pendingNotice: {
				fromVersion: "1.0.0",
				toVersion: "1.0.1",
				startedAt: 123_456,
			},
		},
	);
	assert.equal(await readFile(logPath, "utf8"), "ok");
	const updateLog = (await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(updateLog, [
		{
			timestamp: "1970-01-01T00:02:03.456Z",
			event: "started",
			command: process.execPath,
			args: [
				"-e",
				`require("node:fs").writeFileSync(${JSON.stringify(logPath)}, "ok")`,
			],
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
	const config = await readFile(join(env.CODEX_HOME, "config.toml"), "utf8");
	assert.doesNotMatch(
		config,
		/^(?:model|model_context_window|model_reasoning_effort|plan_mode_reasoning_effort)\s*=/m,
	);
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
			LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify([
				"-e",
				"process.exit(1)",
			]),
		},
		now: 123_456,
	});
	assert.equal(failed.started, true);
	assert.equal(failed.status, 1);
	assert.deepEqual(
		JSON.parse(
			await readFile(baseEnv.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8"),
		),
		{
			lastAttemptedAt: 123_456,
			lastStatus: "failed",
		},
	);

	const retried = await runAutoUpdateCheck({
		env: {
			...baseEnv,
			LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify([
				"-e",
				`require("node:fs").writeFileSync(${JSON.stringify(successPath)}, "ok")`,
			]),
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
	const config = await readFile(
		join(root, "codex-home", "config.toml"),
		"utf8",
	);
	assert.doesNotMatch(
		config,
		/^(?:model|model_context_window|model_reasoning_effort|plan_mode_reasoning_effort)\s*=/m,
	);
});

test("#given stale lock #when running check #then removes lock and runs update", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-auto-update-stale-lock-"),
	);
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
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify([
			"-e",
			`require("node:fs").writeFileSync(${JSON.stringify(successPath)}, "ok")`,
		]),
	});

	const result = await runAutoUpdateCheck({
		env,
		now: 1_000_000,
	});

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(successPath, "utf8"), "ok");
	assert.deepEqual(
		JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")),
		{
			lastCheckedAt: 1_000_000,
			lastAttemptedAt: 1_000_000,
			lastStatus: "success",
			pendingNotice: {
				fromVersion: "1.0.0",
				toVersion: "1.0.1",
				startedAt: 1_000_000,
			},
		},
	);
});
