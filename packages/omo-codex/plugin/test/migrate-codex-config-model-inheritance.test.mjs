import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { runAutoUpdateCheck } from "../scripts/auto-update.mjs";
import {
	migrateCodexConfig,
	migrateConfigFile,
} from "../scripts/migrate-codex-config.mjs";

const ROOT_PROFILE_KEY =
	/^(model|model_context_window|model_reasoning_effort|plan_mode_reasoning_effort)\s*=/;

test("#given blank config #when migration runs #then Codex root model inheritance remains intact", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-model-inherit-blank-"));
	const configPath = join(root, "config.toml");
	await writeFile(configPath, "");

	const result = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
	});

	const content = await readFile(configPath, "utf8");
	assert.equal(result.changed, true);
	assertSessionlessCompatibilityConfig(content);
});

test("#given blank config and no session model #when required-session migration runs twice #then the compatibility pair is byte-idempotent", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-model-inherit-sessionless-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(configPath, "");

	const firstResult = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		requireSessionModel: true,
	});
	const first = await readFile(configPath, "utf8");
	const secondResult = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		requireSessionModel: true,
	});
	const second = await readFile(configPath, "utf8");

	assert.equal(firstResult.changed, true);
	assert.equal(secondResult.changed, false);
	assert.equal(second, first);
	assertSessionlessCompatibilityConfig(second);
});

test("#given project config with only section settings #when migration runs #then no root model profile is materialized", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-model-inherit-project-"),
	);
	const codexHome = join(root, "codex-home");
	const project = join(root, "project", "nested");
	const projectConfigPath = join(root, "project", ".codex", "config.toml");
	await mkdir(codexHome, { recursive: true });
	await mkdir(dirname(projectConfigPath), { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "private-global"\n');
	await writeFile(
		projectConfigPath,
		[
			"[mcp_servers.local]",
			'command = "node"',
			"",
			"[hooks]",
			"enabled = true",
			"",
			"[features]",
			"plugins = true",
			"",
			"[agents]",
			"max_depth = 4",
			"",
		].join("\n"),
	);

	await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: project,
	});

	const content = await readFile(projectConfigPath, "utf8");
	assert.deepEqual(rootProfileAssignments(content), []);
	assert.match(content, /\[mcp_servers\.local\][\s\S]*command = "node"/);
	assert.match(content, /\[hooks\][\s\S]*enabled = true/);
	assert.match(content, /\[agents\][\s\S]*max_depth = 4/);
});

test("#given explicit root GPT-5.6 settings #when migration runs #then the user selection is preserved", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-model-inherit-explicit-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		['model = "gpt-5.6-sol"', 'model_reasoning_effort = "max"', ""].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(rootProfileAssignments(content), [
		'model = "gpt-5.6-sol"',
		'model_reasoning_effort = "max"',
	]);
});

test("#given explicit custom root settings #when migration runs #then the custom profile is preserved", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-model-inherit-custom-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		['model = "private/model"', 'model_reasoning_effort = "medium"', ""].join(
			"\n",
		),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(rootProfileAssignments(content), [
		'model = "private/model"',
		'model_reasoning_effort = "medium"',
	]);
});

test("#given only a nested agent model #when migration runs #then the nested pin remains explicit and root inheritance remains", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-model-inherit-nested-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[agents.explorer]",
			'model = "gpt-5.6-terra"',
			'model_reasoning_effort = "medium"',
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(rootProfileAssignments(content), []);
	assert.match(
		content,
		/\[agents\.explorer\]\nmodel = "gpt-5\.6-terra"\nmodel_reasoning_effort = "medium"/,
	);
});

test("#given inherited root model config #when migration runs twice #then the second run is byte-idempotent", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-model-inherit-idempotent-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(configPath, "[features]\nplugins = true\n");

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });
	const first = await readFile(configPath, "utf8");
	const secondResult = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
	});
	const second = await readFile(configPath, "utf8");

	assert.equal(secondResult.changed, false);
	assert.equal(second, first);
	assert.deepEqual(rootProfileAssignments(second), []);
});

test("#given config migration is disabled #when SessionStart auto-update runs #then config remains byte-identical", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-model-inherit-disabled-"),
	);
	const codexHome = join(root, "codex-home");
	const configPath = join(codexHome, "config.toml");
	const before = "[features]\nplugins = false\n";
	await mkdir(codexHome, { recursive: true });
	await writeFile(configPath, before);

	const result = await runAutoUpdateCheck({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
			LAZYCODEX_AUTO_UPDATE_DISABLED: "1",
			LAZYCODEX_AUTO_UPDATE_STATE_PATH: join(root, "update-state.json"),
			LAZYCODEX_AUTO_UPDATE_LOG_PATH: join(root, "update.log"),
		},
		now: 123_456,
	});

	assert.equal(result.reason, "disabled");
	assert.equal(await readFile(configPath, "utf8"), before);
});

function rootProfileAssignments(config) {
	const assignments = [];
	for (const line of config.split(/\n/)) {
		if (line.trimStart().startsWith("[")) break;
		if (ROOT_PROFILE_KEY.test(line.trimStart())) assignments.push(line.trim());
	}
	return assignments;
}

function assertSessionlessCompatibilityConfig(config) {
	assert.deepEqual(rootProfileAssignments(config), []);
	assert.equal(config.match(/^tool_namespace\s*=\s*"agents"$/gm)?.length, 1);
	assert.equal(
		config.match(/^hide_spawn_agent_metadata\s*=\s*false$/gm)?.length,
		1,
	);
	assert.doesNotMatch(config, /^enabled\s*=/m);
	assert.doesNotMatch(config, /^max_concurrent_threads_per_session\s*=/m);
	assert.doesNotMatch(config, /^max_threads\s*=/m);
}
