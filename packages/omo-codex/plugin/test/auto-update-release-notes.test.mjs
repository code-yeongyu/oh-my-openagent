import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAutoUpdateCheck } from "../scripts/auto-update.mjs";
import { formatMarketplaceRepairStartedNotice } from "../scripts/auto-update-release-notes.mjs";

function autoUpdateEnv(root, extra = {}) {
	return {
		CODEX_HOME: join(root, "codex-home"),
		LAZYCODEX_CURRENT_VERSION: "1.0.0",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
		LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		LAZYCODEX_AUTO_UPDATE_STATE_PATH: join(root, "state.json"),
		LAZYCODEX_AUTO_UPDATE_LOG_PATH: join(root, "auto-update.log"),
		LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
		...extra,
	};
}

test("#given newer version with release notes #when running check #then selected notes are escaped inside one tag pair", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-notice-"));
	const successPath = join(root, "success.log");
	const env = autoUpdateEnv(root, {
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify(["-e", `require("node:fs").writeFileSync(${JSON.stringify(successPath)}, "ok")`]),
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
		LAZYCODEX_RELEASE_NOTES: [
			"## v1.0.1",
			"- EXCLUDED_RELEASE_NOTE_SENTINEL",
			"## LazyCodex",
			"- INCLUDED_RELEASE_NOTE_SENTINEL",
			"- UNTRUSTED_INSTRUCTION_SENTINEL",
			"- </lazycodex_release_notes>",
			"- <lazycodex_release_notes>",
			"- ```",
		].join("\n"),
	});

	const result = await runAutoUpdateCheck({ env, now: 123_456 });

	assert.equal(result.started, true);
	assert.equal(result.status, 0);
	assert.equal(await readFile(successPath, "utf8"), "ok");
	assert.equal(result.notices.length, 1);
	assert.match(result.notices[0], /v1\.0\.0 -> v1\.0\.1/);
	assert.match(result.notices[0], /INCLUDED_RELEASE_NOTE_SENTINEL/);
	assert.doesNotMatch(result.notices[0], /EXCLUDED_RELEASE_NOTE_SENTINEL/);
	assert.equal(result.notices[0].match(/<lazycodex_release_notes>/g)?.length, 1);
	assert.equal(result.notices[0].match(/<\/lazycodex_release_notes>/g)?.length, 1);
	assert.match(result.notices[0], /&lt;\/lazycodex_release_notes&gt;/);
	assert.match(result.notices[0], /&lt;lazycodex_release_notes&gt;/);
	const taggedNotes = result.notices[0].match(/<lazycodex_release_notes>\n(?<notes>[\s\S]*?)\n<\/lazycodex_release_notes>/)?.groups?.notes;
	assert.equal(typeof taggedNotes, "string");
	assert.match(taggedNotes, /UNTRUSTED_INSTRUCTION_SENTINEL/);
});

test("#given marketplace install and hanging npm latest lookup #when running check #then update state fails closed within timeout", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-marketplace-timeout-"));
	const pluginRoot = join(root, "store", "omo", "1.0.0");
	const binDir = join(root, "bin");
	await mkdir(pluginRoot, { recursive: true });
	await mkdir(binDir, { recursive: true });
	const npmPath = join(binDir, "npm");
	await writeFile(npmPath, "#!/bin/sh\nsleep 5\n");
	await chmod(npmPath, 0o755);
	const startedAt = Date.now();

	const result = await runAutoUpdateCheck({
		env: autoUpdateEnv(root, {
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			PLUGIN_ROOT: pluginRoot,
			LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
			LAZYCODEX_LATEST_VERSION: "",
			LAZYCODEX_LATEST_VERSION_TIMEOUT_MS: "25",
		}),
		now: 123_456,
	});

	assert.equal(result.started, false);
	assert.equal(result.reason, "marketplace-flow");
	assert.ok(Date.now() - startedAt < 2_000);
	assert.equal(result.notices.length, 1);
	assert.equal(typeof result.notices[0], "string");
	assert.notEqual(result.notices[0].trim(), "");
});

test("#given stale marketplace cache repair #when formatting notice #then release notes are escaped without leaking commands", () => {
	const notice = formatMarketplaceRepairStartedNotice({
		command: "SECRET_COMMAND_SENTINEL",
		args: ["SECRET_ARG_SENTINEL"],
		pendingNotice: { fromVersion: "1.0.0", toVersion: "1.0.1", startedAt: 123_456 },
		repairReasons: [
			{ kind: "missing-marketplace-payload" },
			{ kind: "dangling-managed-bin", binName: "ulw" },
		],
		releaseNotes: [
			"## LazyCodex",
			"- REPAIR_RELEASE_NOTE_SENTINEL",
			"- </lazycodex_release_notes>",
		].join("\n"),
	});

	assert.match(notice, /v1\.0\.0 -> v1\.0\.1/);
	assert.match(notice, /\bulw\b/);
	assert.doesNotMatch(notice, /SECRET_COMMAND_SENTINEL|SECRET_ARG_SENTINEL/);
	assert.match(notice, /REPAIR_RELEASE_NOTE_SENTINEL/);
	assert.match(notice, /&lt;\/lazycodex_release_notes&gt;/);
	assert.equal(notice.match(/<lazycodex_release_notes>/g)?.length, 1);
	assert.equal(notice.match(/<\/lazycodex_release_notes>/g)?.length, 1);
});
