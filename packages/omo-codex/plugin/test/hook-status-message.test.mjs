import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	formatLazyCodexHookStatusMessage,
	normalizeLazyCodexHookStatusLabel,
	parseLazyCodexHookStatusMessage,
} from "../scripts/hook-status-message.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..", "..");

const AGGREGATE_EXPECTED_LABELS = new Map([
	["hooks/hooks.json:SessionStart:0:0", "Loading Project Rules"],
	["hooks/hooks.json:SessionStart:1:0", "Recording Session Telemetry"],
	["hooks/hooks.json:SessionStart:2:0", "Checking Auto Update"],
	["hooks/hooks.json:SessionStart:3:0", "Checking Bootstrap Provisioning"],
	["hooks/hooks.json:UserPromptSubmit:0:0", "Loading Project Rules"],
	["hooks/hooks.json:UserPromptSubmit:1:0", "Checking Ultrawork Trigger"],
	["hooks/hooks.json:UserPromptSubmit:2:0", "Checking Ulw-Loop Steering"],
	["hooks/hooks.json:PreToolUse:0:0", "Recommending Git Bash MCP"],
	["hooks/hooks.json:PreToolUse:1:0", "Enforcing Unlimited Goal Budget"],
	["hooks/hooks.json:PostToolUse:0:0", "Checking Comments"],
	["hooks/hooks.json:PostToolUse:0:1", "Checking LSP Diagnostics"],
	["hooks/hooks.json:PostToolUse:1:0", "Matching Project Rules"],
	["hooks/hooks.json:PostCompact:0:0", "Resetting Git Bash MCP Reminder"],
	["hooks/hooks.json:PostCompact:1:0", "Resetting Project Rule Cache"],
	["hooks/hooks.json:PostCompact:2:0", "Resetting LSP Diagnostics Cache"],
	["hooks/hooks.json:Stop:0:0", "Checking Start-Work Continuation"],
	["hooks/hooks.json:SubagentStop:0:0", "Checking Start-Work Continuation"],
	["hooks/hooks.json:SubagentStop:1:0", "Verifying LazyCodex Executor Evidence"],
]);

const COMPONENT_EXPECTED_LABELS = new Map([
	["components/comment-checker/hooks/hooks.json:PostToolUse:0:0", "Checking Comments"],
	["components/lsp/hooks/hooks.json:PostToolUse:0:0", "Checking LSP Diagnostics"],
	["components/lsp/hooks/hooks.json:PostCompact:0:0", "Resetting LSP Diagnostics Cache"],
	["components/rules/hooks/hooks.json:SessionStart:0:0", "Loading Project Rules"],
	["components/rules/hooks/hooks.json:UserPromptSubmit:0:0", "Loading Project Rules"],
	["components/rules/hooks/hooks.json:PostToolUse:0:0", "Matching Project Rules"],
	["components/rules/hooks/hooks.json:PostCompact:0:0", "Resetting Project Rule Cache"],
	["components/telemetry/hooks/hooks.json:SessionStart:0:0", "Recording Session Telemetry"],
	["components/ultrawork/hooks/hooks.json:UserPromptSubmit:0:0", "Checking Ultrawork Trigger"],
	["components/ulw-loop/hooks/hooks.json:UserPromptSubmit:0:0", "Checking Ulw-Loop Steering"],
	["components/ulw-loop/hooks/hooks.json:PreToolUse:0:0", "Enforcing Unlimited Ulw-Loop Budget"],
	["components/start-work-continuation/hooks/hooks.json:Stop:0:0", "Checking Start-Work Continuation"],
	["components/start-work-continuation/hooks/hooks.json:SubagentStop:0:0", "Checking Start-Work Continuation"],
	[
		"components/lazycodex-executor-verify/hooks/hooks.json:SubagentStop:0:0",
		"Verifying LazyCodex Executor Evidence",
	],
	["components/git-bash/hooks/hooks.json:PreToolUse:0:0", "Recommending Git Bash MCP"],
	["components/git-bash/hooks/hooks.json:PostCompact:0:0", "Resetting Git Bash MCP Reminder"],
]);

async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

async function readRepoJson(relativePath) {
	return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function readPluginVersion() {
	return (await readJson(".codex-plugin/plugin.json")).version;
}

async function readComponentVersion(componentName) {
	return (await readJson(join("components", componentName, "package.json"))).version;
}

async function exists(relativePath) {
	try {
		await access(join(root, relativePath));
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function readComponentHookManifests() {
	const components = await readdir(join(root, "components"), { withFileTypes: true });
	const manifests = [];
	for (const entry of components) {
		if (!entry.isDirectory()) continue;
		const source = join("components", entry.name, "hooks", "hooks.json");
		if (!(await exists(source))) continue;
		const version = await readComponentVersion(entry.name);
		manifests.push({ source, version, hooks: await readJson(source) });
	}
	return manifests.sort((left, right) => left.source.localeCompare(right.source));
}

function collectCommandHooks(hooks, source, version) {
	const commandHooks = [];
	const normalizedSource = source.replaceAll("\\", "/");
	for (const [eventName, groups] of Object.entries(hooks.hooks)) {
		groups.forEach((group, groupIndex) => {
			group.hooks.forEach((handler, handlerIndex) => {
				if (handler.type !== "command") return;
				commandHooks.push({
					id: `${normalizedSource}:${eventName}:${groupIndex}:${handlerIndex}`,
					version,
					command: handler.command,
					statusMessage: handler.statusMessage,
				});
			});
		});
	}
	return commandHooks;
}

test("#given hook status label #when formatting #then prefixes LazyCodex with current version", async () => {
	// given
	const version = (await readRepoJson("package.json")).version;
	const label = "Checking Comments";

	// when
	const message = formatLazyCodexHookStatusMessage(version, label);

	// then
	assert.equal(message, `LazyCodex(${version}): Checking Comments`);
});

test("#given hook status label with blank version #when formatting #then prefixes LazyCodex with local version", () => {
	// given
	const version = "  ";
	const label = "Checking Comments";

	// when
	const message = formatLazyCodexHookStatusMessage(version, label);

	// then
	assert.equal(message, "LazyCodex(local): Checking Comments");
});

test("#given loose legacy status label #when normalizing #then removes OMO wording and title-cases label", async () => {
	// given
	const version = (await readRepoJson("package.json")).version;
	const label = "  checking   OMO comments  ";

	// when
	const normalized = normalizeLazyCodexHookStatusLabel(label);
	const message = formatLazyCodexHookStatusMessage(version, label);

	// then
	assert.equal(normalized, "Checking Comments");
	assert.equal(message, `LazyCodex(${version}): Checking Comments`);
});

test("#given LazyCodex appears inside hook label #when normalizing #then product casing is preserved", async () => {
	// given
	const version = (await readRepoJson("package.json")).version;
	const label = "verifying lazycodex executor evidence";

	// when
	const normalized = normalizeLazyCodexHookStatusLabel(label);
	const message = formatLazyCodexHookStatusMessage(version, label);

	// then
	assert.equal(normalized, "Verifying LazyCodex Executor Evidence");
	assert.equal(message, `LazyCodex(${version}): Verifying LazyCodex Executor Evidence`);
});

test("#given MCP appears inside hook label #when normalizing #then protocol casing is preserved", () => {
	// given
	const label = "recommending git bash mcp";

	// when
	const normalized = normalizeLazyCodexHookStatusLabel(label);
	const message = formatLazyCodexHookStatusMessage("4.10.0", label);

	// then
	assert.equal(normalized, "Recommending Git Bash MCP");
	assert.equal(message, "LazyCodex(4.10.0): Recommending Git Bash MCP");
});
test("#given aggregate comment-checker hook #when status is inspected #then it uses LazyCodex comments label", async () => {
	// given
	const aggregateVersion = await readPluginVersion();
	const aggregateHooks = await readJson("hooks/hooks.json");

	// when
	const hooks = collectCommandHooks(aggregateHooks, "hooks/hooks.json", aggregateVersion);
	const commentCheckerHook = hooks.find((hook) => hook.id === "hooks/hooks.json:PostToolUse:0:0");

	// then
	assert.equal(commentCheckerHook?.statusMessage, formatLazyCodexHookStatusMessage(aggregateVersion, "Checking Comments"));
	assert.doesNotMatch(JSON.stringify(aggregateHooks), /checking\s+OMO\s+comments/i);
});

test("#given aggregate and component hooks #when status messages are inspected #then all use the LazyCodex formatter", async () => {
	// given
	const aggregateVersion = await readPluginVersion();
	const aggregateHooks = await readJson("hooks/hooks.json");
	const componentManifests = await readComponentHookManifests();

	// when
	const commandHooks = [
		...collectCommandHooks(aggregateHooks, "hooks/hooks.json", aggregateVersion),
		...componentManifests.flatMap((manifest) => collectCommandHooks(manifest.hooks, manifest.source, manifest.version)),
	];
	const expectedLabels = new Map([...AGGREGATE_EXPECTED_LABELS, ...COMPONENT_EXPECTED_LABELS]);
	const mismatches = commandHooks
		.map((hook) => {
			const parsed = parseLazyCodexHookStatusMessage(hook.statusMessage);
			const label = parsed?.label;
			const expected = label === undefined ? undefined : formatLazyCodexHookStatusMessage(hook.version, label);
			return { ...hook, expected, parsed };
		})
		.filter((hook) => hook.expected === undefined || hook.statusMessage !== hook.expected || hook.parsed === null)
		.map((hook) => `${hook.id}: expected ${hook.expected ?? "<missing expectation>"} but got ${hook.statusMessage}`);

	// then
	assert.deepEqual(mismatches, []);
	const actualLabels = new Set(commandHooks.map((hook) => parseLazyCodexHookStatusMessage(hook.statusMessage)?.label));
	assert.deepEqual([...expectedLabels.values()].filter((label) => !actualLabels.has(label)), []);
	for (const hook of commandHooks) {
		assert.doesNotMatch(hook.statusMessage, /\bOMO\b/i);
	}
});
