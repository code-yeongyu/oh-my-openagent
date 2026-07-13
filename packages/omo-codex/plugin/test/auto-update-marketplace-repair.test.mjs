import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
	resolveAutoUpdatePlan,
	runAutoUpdateCheck,
} from "../scripts/auto-update.mjs";
import {
	makeStorePluginRoot,
	marketplaceCheckEnv,
} from "./auto-update-test-fixture.mjs";

test("#given marketplace flow with stale local cache state #when running check #then starts npx repair instead of marketplace skip", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-marketplace-repair-",
	);
	const spawnLogPath = join(root, "spawn.log");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex-home");
	const missingCachedCli = join(
		codexHome,
		"plugins",
		"cache",
		"sisyphuslabs",
		"omo",
		"1.0.1",
		"components",
		"ulw-loop",
		"dist",
		"cli.js",
	);
	await mkdir(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"),
		{ recursive: true },
	);
	await mkdir(binDir, { recursive: true });
	await writeFile(
		join(
			codexHome,
			"plugins",
			"cache",
			"sisyphuslabs",
			".agents",
			"plugins",
			"marketplace.json",
		),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [
				{ name: "omo", source: { source: "local", path: "./omo/1.0.1" } },
			],
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
	assert.doesNotMatch(
		result.notices[0],
		/plugins[\\/]+cache[\\/]+sisyphuslabs/,
	);
	const logEntries = (
		await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")
	)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
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
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-marketplace-repair-throttle-",
	);
	const spawnLogPath = join(root, "spawn.log");
	const codexHome = join(root, "codex-home");
	await mkdir(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"),
		{ recursive: true },
	);
	await writeFile(
		join(
			codexHome,
			"plugins",
			"cache",
			"sisyphuslabs",
			".agents",
			"plugins",
			"marketplace.json",
		),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [
				{ name: "omo", source: { source: "local", path: "./omo/1.0.1" } },
			],
		}),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});

	const plan = resolveAutoUpdatePlan({
		env,
		now: 123_457,
		lastCheckedAt: 123_456,
		lastStatus: "success",
	});

	assert.equal(plan.shouldRun, true);
	assert.equal(plan.kind, "marketplace-local-repair");
	assert.deepEqual(plan.repairReasons, [
		{ kind: "missing-marketplace-payload" },
	]);
});

test("#given stale marketplace cache and recent started state #when resolving plan #then repair honors retry throttle", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-marketplace-repair-retry-",
	);
	const spawnLogPath = join(root, "spawn.log");
	const codexHome = join(root, "codex-home");
	await mkdir(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"),
		{ recursive: true },
	);
	await writeFile(
		join(
			codexHome,
			"plugins",
			"cache",
			"sisyphuslabs",
			".agents",
			"plugins",
			"marketplace.json",
		),
		JSON.stringify({
			name: "sisyphuslabs",
			plugins: [
				{ name: "omo", source: { source: "local", path: "./omo/1.0.1" } },
			],
		}),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
		LAZYCODEX_LATEST_VERSION: "1.0.1",
	});

	const plan = resolveAutoUpdatePlan({
		env,
		now: 123_457,
		lastAttemptedAt: 123_456,
		lastStatus: "started",
	});

	assert.equal(plan.shouldRun, false);
	assert.equal(plan.reason, "retry-throttled");
});

test("#given marketplace flow with stale Windows generated shim #when resolving plan #then starts local repair", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-marketplace-windows-repair-",
	);
	const spawnLogPath = join(root, "spawn.log");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex-home");
	const missingCachedCli = join(
		codexHome,
		"plugins",
		"cache",
		"sisyphuslabs",
		"omo",
		"1.0.1",
		"components",
		"ulw-loop",
		"dist",
		"cli.js",
	);
	await mkdir(binDir, { recursive: true });
	await writeFile(
		join(binDir, "omo-ulw-loop.cmd"),
		[
			"@echo off",
			":: generated by oh-my-openagent Codex installer",
			`"${missingCachedCli}" %*`,
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
	assert.deepEqual(plan.repairReasons, [
		{ kind: "dangling-managed-bin", binName: "omo-ulw-loop" },
	]);
});

test("#given marketplace flow with non-managed stale cache-shaped bin #when resolving plan #then skips local repair", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-marketplace-user-bin-",
	);
	const spawnLogPath = join(root, "spawn.log");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex-home");
	const missingCachedCli = join(
		codexHome,
		"plugins",
		"cache",
		"sisyphuslabs",
		"omo",
		"1.0.1",
		"components",
		"ulw-loop",
		"dist",
		"cli.js",
	);
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
