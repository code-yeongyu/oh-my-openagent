import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

const ROOT_PROFILE_KEY =
	/^(model|model_context_window|model_reasoning_effort|plan_mode_reasoning_effort)\s*=/;

test("#given blank config #when generated installer updates config #then root model inheritance remains intact", async () => {
	const content = await installConfig("");

	assert.deepEqual(rootProfileAssignments(content), []);
	assert.match(content, /\[features\.multi_agent_v2\]/);
	assert.match(content, /^tool_namespace = "agents"$/m);
	assert.match(content, /^hide_spawn_agent_metadata = false$/m);
});

test("#given project-style section config #when generated installer updates config #then root model inheritance remains intact", async () => {
	const content = await installConfig(
		[
			"[mcp_servers.local]",
			'command = "node"',
			"",
			"[hooks]",
			"enabled = true",
			"",
			"[features]",
			"plugins = false",
			"",
			"[agents]",
			"max_depth = 4",
			"",
		].join("\n"),
	);

	assert.deepEqual(rootProfileAssignments(content), []);
	assert.match(content, /\[mcp_servers\.local\]/);
	assert.match(content, /\[hooks\]/);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /^tool_namespace = "agents"$/m);
	assert.match(content, /^hide_spawn_agent_metadata = false$/m);
});

test("#given explicit root GPT-5.6 config #when generated installer updates config #then it preserves the explicit selection", async () => {
	const content = await installConfig(
		['model = "gpt-5.6-sol"', 'model_reasoning_effort = "max"', ""].join("\n"),
	);

	assert.deepEqual(rootProfileAssignments(content), [
		'model = "gpt-5.6-sol"',
		'model_reasoning_effort = "max"',
	]);
});

test("#given explicit custom root config #when generated installer updates config #then it preserves the custom selection", async () => {
	const content = await installConfig(
		['model = "private/model"', 'model_reasoning_effort = "medium"', ""].join(
			"\n",
		),
	);

	assert.deepEqual(rootProfileAssignments(content), [
		'model = "private/model"',
		'model_reasoning_effort = "medium"',
	]);
});

test("#given only a nested agent model #when generated installer updates config #then the nested pin remains and root model stays inherited", async () => {
	const content = await installConfig(
		[
			"[agents.explorer]",
			'model = "gpt-5.6-terra"',
			'model_reasoning_effort = "medium"',
			"",
		].join("\n"),
	);

	assert.deepEqual(rootProfileAssignments(content), []);
	assert.match(content, /\[agents\.explorer\]\nmodel = "gpt-5\.6-terra"/);
	assert.match(content, /^tool_namespace = "agents"$/m);
	assert.match(content, /^hide_spawn_agent_metadata = false$/m);
});

test("#given inherited root model config #when generated installer runs twice #then the second run is byte-idempotent", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-model-inherit-idempotent-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(configPath, "[features]\nplugins = false\n");

	await update(configPath);
	const first = await readFile(configPath, "utf8");
	await update(configPath);
	const second = await readFile(configPath, "utf8");

	assert.equal(second, first);
	assert.deepEqual(rootProfileAssignments(second), []);
});

async function installConfig(initial) {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-model-inherit-"));
	const configPath = join(root, "config.toml");
	await writeFile(configPath, initial);
	await update(configPath);
	return readFile(configPath, "utf8");
}

async function update(configPath) {
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});
}

function rootProfileAssignments(config) {
	const assignments = [];
	for (const line of config.split(/\n/)) {
		if (line.trimStart().startsWith("[")) break;
		if (ROOT_PROFILE_KEY.test(line.trimStart())) assignments.push(line.trim());
	}
	return assignments;
}
