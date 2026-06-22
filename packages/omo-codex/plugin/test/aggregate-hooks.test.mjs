import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
	collectCommandHooks,
	exists,
	hookLocation,
	readAggregateHookManifests,
	readComponentHookManifests,
	root,
} from "./aggregate-plugin-fixture.mjs";

async function readAggregateCommandHooks() {
	const manifests = await readAggregateHookManifests();
	return manifests.flatMap(({ source, hooks }) => collectCommandHooks(hooks, source));
}

async function readAggregateHooksText() {
	const manifests = await readAggregateHookManifests();
	return manifests.map(({ hooks }) => JSON.stringify(hooks)).join("\n");
}

test("#given isolated components #when hooks are inspected #then commands stay inside component roots", async () => {
	// given
	const text = await readAggregateHooksText();

	// when
	const componentMarkers = [
		"components/comment-checker/dist/cli.js",
		"components/lsp/dist/cli.js",
		"components/codegraph/dist/cli.js",
		"components/rules/dist/cli.js",
		"components/start-work-continuation/dist/cli.js",
		"components/telemetry/dist/cli.js",
		"components/teammode/dist/cli.js",
		"components/ulw-loop/dist/cli.js",
		"components/ultrawork/dist/cli.js",
		"scripts/auto-update.mjs",
	];

	// then
	for (const marker of componentMarkers) {
		assert.match(text, new RegExp(marker.replaceAll("/", "\\/")));
	}
	assert.doesNotMatch(text, /codex-(comment-checker|lsp|rules|telemetry|ulw-loop|ultrawork)@/);
	assert.equal(await exists("scripts/migrate-codex-config.mjs"), true);
});

test("#given aggregate SubagentStop hooks #when inspected #then start-work and LazyCodex executor verifier are separate groups", async () => {
	// given
	const manifests = await readAggregateHookManifests();

	// when
	const subagentStopGroups = manifests.filter(({ hooks }) => hooks.hooks.SubagentStop).flatMap(({ hooks }) => hooks.hooks.SubagentStop);
	const verifierGroups = manifests.flatMap(({ source, hooks }) => collectCommandHooks(hooks, source)).filter(
		(hook) =>
			hook.eventName === "SubagentStop" &&
			hook.handler.command ===
				'node "${PLUGIN_ROOT}/components/lazycodex-executor-verify/dist/cli.js" hook subagent-stop',
	);

	// then
	assert.equal(subagentStopGroups.length, 2);
	assert.equal(subagentStopGroups[0]?.matcher, undefined);
	assert.equal(subagentStopGroups[1]?.matcher, "^lazycodex-executor$");
	assert.equal(verifierGroups.length, 1);
	assert.equal(verifierGroups[0]?.groupIndex, 0);
	assert.equal(verifierGroups[0]?.handler.timeout, 10);
	assert.equal(verifierGroups[0]?.handler.statusMessage, "(OmO) Verifying LazyCodex Executor Evidence");
});

test("#given aggregate PostCompact hooks #when hooks are inspected #then LSP diagnostics cache reset is registered", async () => {
	// given
	const commandHooks = await readAggregateCommandHooks();

	// when
	const lspPostCompactHooks = commandHooks.filter(
		(hook) =>
			hook.eventName === "PostCompact" &&
			hook.handler.command === 'node "${PLUGIN_ROOT}/components/lsp/dist/cli.js" hook post-compact',
	);

	// then
	assert.equal(lspPostCompactHooks.length, 1);
	assert.equal(lspPostCompactHooks[0]?.handler.statusMessage, "(OmO) Resetting LSP Diagnostics Cache");
});

test("#given aggregate hook commands #when inspected #then every command exposes a Codex status message", async () => {
	// given
	// when
	const commandHooks = await readAggregateCommandHooks();
	const missingStatusMessages = commandHooks
		.filter(({ handler }) => typeof handler.statusMessage !== "string" || handler.statusMessage.trim() === "")
		.map(hookLocation);

	// then
	assert.deepEqual(missingStatusMessages, []);
});

test("#given aggregate hook commands #when inspected #then commands stay Node-based and platform-neutral", async () => {
	// given
	// when
	const commands = (await readAggregateCommandHooks()).map(({ handler }) => handler.command);

	// then
	assert(!commands.some((command) => /\bpython3?\b/i.test(command)));
	assert(commands.includes('node "${PLUGIN_ROOT}/components/ultrawork/dist/cli.js" hook user-prompt-submit'));
	assert(commands.every((command) => command.startsWith("node ")));
	assert(commands.every((command) => !command.includes("\\")));
});

test("#given component hook commands #when inspected #then standalone packages expose Codex status messages", async () => {
	// given
	const componentHooks = await readComponentHookManifests();

	// when
	const missingStatusMessages = componentHooks
		.flatMap(({ source, hooks }) => collectCommandHooks(hooks, source))
		.filter(({ handler }) => typeof handler.statusMessage !== "string" || handler.statusMessage.trim() === "")
		.map(hookLocation);

	// then
	assert.deepEqual(missingStatusMessages, []);
});

test("#given hook status messages #when inspected #then labels describe OMO responsibilities instead of the hook runner", async () => {
	// given
	const componentHooks = await readComponentHookManifests();

	// when
	const commandHooks = [
		...(await readAggregateCommandHooks()),
		...componentHooks.flatMap(({ source, hooks }) => collectCommandHooks(hooks, source)),
	];
	const genericStatusMessages = commandHooks
		.filter(({ handler }) => typeof handler.statusMessage !== "string" || /\bhook\b/i.test(handler.statusMessage))
		.map(hookLocation);

	// then
	assert.deepEqual(genericStatusMessages, []);
});

test("#given aggregate OMO plugin is enabled #when hooks are inspected #then shell guidance and ulw-loop guard are registered", async () => {
	// given
	const manifests = await readAggregateHookManifests();
	const text = await readAggregateHooksText();

	// when
	const preToolUseGroups = manifests.filter(({ hooks }) => hooks.hooks.PreToolUse).flatMap(({ hooks }) => hooks.hooks.PreToolUse);

	// then
	assert.match(text, /components\/git-bash\/dist\/cli\.js/);
	assert.match(text, /Recommending Git Bash MCP/);
	assert.match(text, /hook post-compact/);
	assert.match(text, /Resetting Git Bash MCP Reminder/);
	assert.match(text, /components\/ulw-loop\/dist\/cli\.js/);
	assert.match(text, /hook pre-tool-use/);
	assert.deepEqual(preToolUseGroups.map((group) => group.matcher), ["^Bash$", "^create_goal$"]);
});

test("#given aggregate SessionStart hooks #when inspected #then LazyCodex auto-update is registered", async () => {
	// given
	const manifests = await readAggregateHookManifests();
	const text = await readAggregateHooksText();

	// when
	const sessionStartCommands = (await readAggregateCommandHooks())
		.filter(({ eventName }) => eventName === "SessionStart")
		.map(({ handler }) => handler.command);
	const autoUpdateGroup = manifests
		.filter(({ hooks }) => hooks.hooks.SessionStart)
		.flatMap(({ hooks }) => hooks.hooks.SessionStart)
		.find((group) => JSON.stringify(group).includes("scripts/auto-update.mjs"));

	// then
	assert.equal(autoUpdateGroup?.matcher, "^startup$");
	assert.match(text, /scripts\/auto-update\.mjs/);
	assert.match(text, /Checking Auto Update/);
	assert(sessionStartCommands.some((command) => command.includes("scripts/auto-update.mjs")));
});

test("#given aggregate PostToolUse hooks #when inspected #then CodeGraph init guidance is registered for CodeGraph tools", async () => {
	// given
	const commandHooks = await readAggregateCommandHooks();

	// when
	const codegraphPostToolUseHooks = commandHooks.filter(
		(hook) =>
			hook.eventName === "PostToolUse" &&
			hook.handler.command === 'node "${PLUGIN_ROOT}/components/codegraph/dist/cli.js" hook post-tool-use',
	);

	// then
	assert.equal(codegraphPostToolUseHooks.length, 1);
	assert.equal(codegraphPostToolUseHooks[0]?.matcher, "^(codegraph[._].*|mcp__codegraph__.*)$");
	assert.equal(codegraphPostToolUseHooks[0]?.handler.statusMessage, "(OmO) Checking CodeGraph Init Guidance");
});

test("#given aggregate PostToolUse hooks #when inspected #then thread title hygiene is registered for created Codex threads", async () => {
	// given
	const commandHooks = await readAggregateCommandHooks();

	// when
	const threadTitleHooks = commandHooks.filter(
		(hook) =>
			hook.eventName === "PostToolUse" &&
			hook.handler.command === 'node "${PLUGIN_ROOT}/components/teammode/dist/cli.js" hook post-tool-use',
	);

	// then
	assert.equal(threadTitleHooks.length, 1);
	assert.equal(threadTitleHooks[0]?.matcher, "^(create_thread|codex_app\\.create_thread)$");
	assert.equal(threadTitleHooks[0]?.handler.statusMessage, "(OmO) Checking Thread Title Hygiene");
});

test("#given aggregate plugin packaging #when inspected #then hooks and compatibility sentinels stay Python-free", async () => {
	// given
	const hooksText = (await Promise.all((await readAggregateHookManifests()).map(({ source }) => readFile(join(root, source), "utf8")))).join("\n");
	const aggregateTestText = await readFile(join(root, "test/aggregate.test.mjs"), "utf8");

	// when
	const aggregateText = `${hooksText}\n${aggregateTestText}`;

	// then
	assert.doesNotMatch(aggregateText, /\bpython3?\b|ultrawork-detector\.py/);
});
