import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
	readSessionModelFromStdin,
	resolveAutoUpdatePlan,
	resolveLazyCodexUpdatePlan,
} from "../scripts/auto-update.mjs";
import { resolveSpawnInvocation } from "../scripts/spawn-command.mjs";

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

	assert.equal(
		await readSessionModelFromStdin(stdinFrom(payload)),
		"gpt-5.6-terra",
	);
});

test("#given empty or malformed stdin #when reading session model #then returns null", async () => {
	assert.equal(await readSessionModelFromStdin(stdinFrom("")), null);
	assert.equal(await readSessionModelFromStdin(stdinFrom("not json")), null);
	assert.equal(
		await readSessionModelFromStdin(stdinFrom(JSON.stringify({ model: "  " }))),
		null,
	);
	assert.equal(
		await readSessionModelFromStdin(
			stdinFrom(JSON.stringify({ session_id: "s-1" })),
		),
		null,
	);
	assert.equal(await readSessionModelFromStdin(null), null);
});

test("#given a TTY stdin #when reading session model #then returns null without waiting", async () => {
	const stream = stdinFrom("{}");
	stream.isTTY = true;
	assert.equal(await readSessionModelFromStdin(stream), null);
});

test("#given stale state #when resolving plan #then installer update command is scheduled", () => {
	const plan = resolveAutoUpdatePlan({
		env: {
			LAZYCODEX_CURRENT_VERSION: "1.0.0",
			LAZYCODEX_LATEST_VERSION: "1.0.1",
		},
		now: 90_000_000,
		lastCheckedAt: 0,
	});

	assert.equal(plan.shouldRun, true);
	assert.deepEqual(plan.command, "npx");
	assert.deepEqual(plan.args, [
		"--yes",
		"lazycodex-ai@latest",
		"install",
		"--no-tui",
		"--codex-autonomous",
	]);
});

test("#given Windows npm shims #when resolving spawn commands #then cmd shims are used", () => {
	assert.deepEqual(resolveSpawnInvocation("npm", ["install"], "win32"), {
		command: "cmd.exe",
		args: ["/d", "/s", "/c", "npm.cmd", "install"],
	});
	assert.deepEqual(
		resolveSpawnInvocation("npx", ["--yes", "lazycodex-ai@latest"], "win32"),
		{
			command: "cmd.exe",
			args: ["/d", "/s", "/c", "npx.cmd", "--yes", "lazycodex-ai@latest"],
		},
	);
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
	assert.deepEqual(plan.args, [
		"--yes",
		"lazycodex-ai@latest",
		"install",
		"--no-tui",
		"--codex-autonomous",
	]);
});

test("#given current version is a prerelease of latest #when resolving update plan #then schedules stable installer", () => {
	const plan = resolveLazyCodexUpdatePlan({
		currentVersion: "1.0.1-beta.1",
		latestVersion: "1.0.1",
	});

	assert.equal(plan.shouldUpdate, true);
	assert.deepEqual(plan.args, [
		"--yes",
		"lazycodex-ai@latest",
		"install",
		"--no-tui",
		"--codex-autonomous",
	]);
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
		env: {
			LAZYCODEX_CURRENT_VERSION: "1.0.1",
			LAZYCODEX_LATEST_VERSION: "1.0.1",
		},
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
	await writeFile(
		versionPath,
		JSON.stringify({ packageName: "lazycodex-ai", version: "1.0.1" }),
	);

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
