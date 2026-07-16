import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAutoUpdateCheck } from "../scripts/auto-update.mjs";
import { detectInstallFlow } from "../scripts/install-flow.mjs";
import {
	makeStorePluginRoot,
	marketplaceCheckEnv,
} from "./auto-update-test-fixture.mjs";

test("#given marketplace plugin root without install snapshot #when running check #then skips npx update with marketplace-flow log and upgrade notice", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-auto-update-marketplace-"),
	);
	const codexHome = join(root, "codex-home");
	const pluginRoot = join(
		codexHome,
		"plugins",
		"cache",
		"sisyphuslabs",
		"omo",
		"1.0.0",
	);
	const spawnLogPath = join(root, "spawn.log");
	await mkdir(
		join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"),
		{ recursive: true },
	);
	await mkdir(pluginRoot, { recursive: true });
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
				{ name: "omo", source: { source: "local", path: "./omo/1.0.0" } },
			],
		}),
	);
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath, {
		CODEX_HOME: codexHome,
	});

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, false);
	assert.equal(result.reason, "marketplace-flow");
	assert.equal(result.notices.length, 1);
	assert.match(
		result.notices[0],
		/codex plugin marketplace upgrade sisyphuslabs/,
	);
	assert.match(result.notices[0], /hook re-approval/);
	await assert.rejects(readFile(spawnLogPath, "utf8"), { code: "ENOENT" });
	const state = JSON.parse(
		await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8"),
	);
	assert.equal(state.lastCheckedAt, 123_456);
	assert.equal(state.lastStatus, "success");
	assert.notEqual(state.lastStatus, "started");
	const logEntries = (
		await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")
	)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(logEntries, [
		{
			timestamp: "1970-01-01T00:02:03.456Z",
			event: "skipped",
			kind: "marketplace-flow",
		},
	]);
});

test("#given install snapshot at plugin root #when running check #then npx update behavior is unchanged", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-npx-snapshot-",
	);
	await writeFile(
		join(pluginRoot, "lazycodex-install.json"),
		JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.0" }),
	);
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
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-marketplace-throttle-",
	);
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
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-auto-update-unknown-flow-",
	);
	await mkdir(join(pluginRoot, "lazycodex-install.json"));
	const spawnLogPath = join(root, "spawn.log");
	const env = marketplaceCheckEnv(root, pluginRoot, spawnLogPath);

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(spawnLogPath, "utf8"), "ok");
	const logEntries = (
		await readFile(env.LAZYCODEX_AUTO_UPDATE_LOG_PATH, "utf8")
	)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(logEntries[0].event, "install-flow-unknown");
	assert.match(logEntries[0].reason, /install-snapshot/);
});

test("#given install flow fixtures #when detecting install flow #then discriminates on the install snapshot", async () => {
	const { pluginRoot } = await makeStorePluginRoot(
		"lazycodex-install-flow-detect-",
	);

	assert.deepEqual(detectInstallFlow({ pluginRoot }), {
		flow: "marketplace",
		reason: "install-snapshot-absent",
	});

	await writeFile(
		join(pluginRoot, "lazycodex-install.json"),
		JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.0" }),
	);
	assert.deepEqual(detectInstallFlow({ pluginRoot }), {
		flow: "npx-local",
		reason: "install-snapshot-present",
	});
});

test("#given workspace tree without install snapshot #when detecting install flow #then stays npx-local", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-install-flow-workspace-"),
	);
	const pluginRoot = join(root, "packages", "omo-codex", "plugin");
	await mkdir(pluginRoot, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "oh-my-opencode", version: "4.9.2" }),
	);

	assert.deepEqual(detectInstallFlow({ pluginRoot }), {
		flow: "npx-local",
		reason: "workspace-tree",
	});
});

test("#given snapshot path that is not a regular file #when detecting install flow #then reports unknown", async () => {
	const { pluginRoot } = await makeStorePluginRoot(
		"lazycodex-install-flow-unknown-",
	);
	await mkdir(join(pluginRoot, "lazycodex-install.json"));

	const detected = detectInstallFlow({ pluginRoot });

	assert.equal(detected.flow, "unknown");
	assert.match(detected.reason, /install-snapshot/);
});

test("#given LAZYCODEX_INSTALLED_VERSION_PATH override #when detecting install flow #then honors the override path", async () => {
	const { root, pluginRoot } = await makeStorePluginRoot(
		"lazycodex-install-flow-override-",
	);
	const overridePath = join(root, "elsewhere", "lazycodex-install.json");
	await mkdir(join(root, "elsewhere"), { recursive: true });
	await writeFile(
		overridePath,
		JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.0" }),
	);

	assert.deepEqual(
		detectInstallFlow({
			pluginRoot,
			env: { LAZYCODEX_INSTALLED_VERSION_PATH: overridePath },
		}),
		{
			flow: "npx-local",
			reason: "install-snapshot-present",
		},
	);
});
