import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { syncHookStatusMessages } from "../scripts/sync-hook-status-messages.mjs";

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

test("#given source package versions and component without hooks #when hook status messages sync #then source versions are preserved", async () => {
	// given
	const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-hook-status-"));
	const root = join(repoRoot, "packages", "omo-codex", "plugin");
	await mkdir(root, { recursive: true });
	await mkdir(join(root, ".codex-plugin"), { recursive: true });
	await mkdir(join(root, "hooks"), { recursive: true });
	await mkdir(join(root, "components", "comment-checker", "hooks"), { recursive: true });
	await mkdir(join(root, "components", "lsp", "hooks"), { recursive: true });
	await mkdir(join(root, "components", "git-bash"), { recursive: true });
	await mkdir(join(root, "components", "stale-build-output", "dist"), { recursive: true });
	await writeJson(join(repoRoot, "package.json"), { version: "4.7.5" });
	await writeJson(join(root, ".codex-plugin", "plugin.json"), { version: "0.1.0" });
	await writeJson(join(root, "components", "comment-checker", "package.json"), { version: "0.1.1" });
	await writeJson(join(root, "components", "lsp", "package.json"), { version: "0.2.0" });
	await writeJson(join(root, "components", "git-bash", "package.json"), { version: "0.3.0" });
	await writeJson(join(root, "hooks", "hooks.json"), {
		hooks: {
			PostToolUse: [
				{
					hooks: [
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/components/comment-checker/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(stale): Checking Comments",
						},
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/components/lsp/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(stale): Checking LSP Diagnostics",
						},
					],
				},
			],
		},
	});
	await writeJson(join(root, "components", "comment-checker", "hooks", "hooks.json"), {
		hooks: {
			PostToolUse: [
				{
					hooks: [
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(stale): Checking Comments",
						},
					],
				},
			],
		},
	});
	await writeJson(join(root, "components", "lsp", "hooks", "hooks.json"), {
		hooks: {
			PostToolUse: [
				{
					hooks: [
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(stale): Checking LSP Diagnostics",
						},
					],
				},
			],
		},
	});

	// when
	await syncHookStatusMessages(root);

	// then
	const aggregateHooks = await readJson(join(root, "hooks", "hooks.json"));
	const componentHooks = await readJson(join(root, "components", "comment-checker", "hooks", "hooks.json"));
	const lspHooks = await readJson(join(root, "components", "lsp", "hooks", "hooks.json"));
	assert.equal(aggregateHooks.hooks.PostToolUse[0].hooks[0].statusMessage, "LazyCodex(0.1.0): Checking Comments");
	assert.equal(aggregateHooks.hooks.PostToolUse[0].hooks[1].statusMessage, "LazyCodex(0.1.0): Checking LSP Diagnostics");
	assert.equal(componentHooks.hooks.PostToolUse[0].hooks[0].statusMessage, "LazyCodex(0.1.1): Checking Comments");
	assert.equal(lspHooks.hooks.PostToolUse[0].hooks[0].statusMessage, "LazyCodex(0.2.0): Checking LSP Diagnostics");
});

test("#given release version override #when hook status messages sync #then aggregate hooks use release version", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-hook-status-release-"));
	await mkdir(join(root, ".codex-plugin"), { recursive: true });
	await mkdir(join(root, "hooks"), { recursive: true });
	await mkdir(join(root, "components", "comment-checker", "hooks"), { recursive: true });
	await writeJson(join(root, ".codex-plugin", "plugin.json"), { version: "0.1.0" });
	await writeJson(join(root, "components", "comment-checker", "package.json"), { version: "0.1.1" });
	await writeJson(join(root, "hooks", "hooks.json"), {
		hooks: {
			PostToolUse: [
				{
					hooks: [
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/components/comment-checker/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(stale): Checking Comments",
						},
					],
				},
			],
		},
	});
	await writeJson(join(root, "components", "comment-checker", "hooks", "hooks.json"), {
		hooks: {
			PostToolUse: [
				{
					hooks: [
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(stale): Checking Comments",
						},
					],
				},
			],
		},
	});

	// when
	await syncHookStatusMessages(root, { releaseVersion: "4.8.0" });

	// then
	const aggregateHooks = await readJson(join(root, "hooks", "hooks.json"));
	const componentHooks = await readJson(join(root, "components", "comment-checker", "hooks", "hooks.json"));
	assert.equal(aggregateHooks.hooks.PostToolUse[0].hooks[0].statusMessage, "LazyCodex(4.8.0): Checking Comments");
	assert.equal(componentHooks.hooks.PostToolUse[0].hooks[0].statusMessage, "LazyCodex(4.8.0): Checking Comments");
});
