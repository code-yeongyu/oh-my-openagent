import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateConfigFile } from "../scripts/migrate-codex-config.mjs";

test("#given SessionStart config migration sees an explicit V2 cap #when migrating #then preserves it while raising the legacy cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-migration-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"model_context_window = 123456",
			'model_reasoning_effort = "medium"',
			'plan_mode_reasoning_effort = "medium"',
			"",
			"[agents]",
			"max_threads = 6",
			"max_depth = 4",
			"",
			"[agents.explorer]",
			'config_file = "./agents/explorer.toml"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
		].join("\n"),
	);

	const result = await migrateConfigFile(configPath);

	const content = await readFile(configPath, "utf8");
	assert.equal(result.changed, true);
	assert.match(content, /\[agents\][\s\S]*?max_threads = 1000/);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/);
	assert.match(content, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.match(content, /max_concurrent_threads_per_session = 6/);
	assert.doesNotMatch(content, /^max_threads\s*=\s*6$/m);
});

test("#given gpt-5.6 session model with no models_cache and an explicit V2 cap #when migrating #then removes agents.max_threads but preserves the cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-gpt56-nocache-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			'model_reasoning_effort = "xhigh"',
			"",
			"[agents]",
			"max_threads = 1000",
			"max_depth = 4",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
		].join("\n"),
	);

	const result = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		sessionModel: "gpt-5.6-sol",
	});

	const content = await readFile(configPath, "utf8");
	assert.equal(result.changed, true);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /max_concurrent_threads_per_session = 6/);
});

test("#given SessionStart config migration has no V2 cap #when migrating #then writes the conservative managed default", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-missing-cap-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath);

	const content = await readFile(configPath, "utf8");
	assert.match(content, /max_concurrent_threads_per_session = 16/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given config without any model #when migrating #then does not introduce agents.max_threads", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-no-model-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		['model_reasoning_effort = "high"', "", "[agents]", "max_depth = 4", ""].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /max_concurrent_threads_per_session = 16/);
});

test("#given config without any model but an existing low cap #when migrating #then still raises the existing cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-no-model-raise-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		['model_reasoning_effort = "high"', "", "[agents]", "max_threads = 6", "max_depth = 4", ""].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.match(content, /max_threads = 1000/);
	assert.doesNotMatch(content, /max_threads = 6/);
	assert.match(content, /max_depth = 4/);
});
