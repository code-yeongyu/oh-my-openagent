import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureSubagentConcurrencyLimit } from "../scripts/migrate-codex-config/subagent-limit-guard.mjs";
import { migrateConfigFile } from "../scripts/migrate-codex-config.mjs";

test("#given blank config #when ensuring subagent concurrency #then leaves the V2 cap absent", () => {
	const result = ensureSubagentConcurrencyLimit("", {
		multiAgentVersion: null,
	});

	assert.equal(result, "[features.multi_agent_v2]\n");
	assert.doesNotMatch(result, /max_concurrent_threads_per_session/);
});

test("#given a V2 section without a cap #when ensuring subagent concurrency #then keeps the cap absent", () => {
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		'tool_namespace = "agents"',
		"",
	].join("\n");

	const result = ensureSubagentConcurrencyLimit(config, {
		multiAgentVersion: "v2",
	});

	assert.equal(result, config);
	assert.doesNotMatch(result, /max_concurrent_threads_per_session/);
});

test("#given SessionStart config migration sees custom concurrency values #when migrating #then preserves both", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-subagent-limit-migration-"),
	);
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
	assert.equal(result.changed, false);
	assert.match(content, /\[agents\][\s\S]*?max_threads = 6/);
	assert.match(content, /max_depth = 4/);
	assert.match(
		content,
		/\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/,
	);
	assert.match(content, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.match(content, /max_concurrent_threads_per_session = 6/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session = 1000/);
	assert.doesNotMatch(content, /^max_threads\s*=\s*1000$/m);
});

test("#given a historical OMO-managed V2 cap #when migrating #then removes only the managed 1000", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-subagent-limit-managed-v2-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			"",
			"# Work around openai/codex#26753: multi_agent_v2 is re-disabled on every Codex session start",
			"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		sessionModel: "gpt-5.6-sol",
	});

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
	assert.doesNotMatch(content, /Managed by LazyCodex: multi_agent_v2/);
});

test("#given an unrelated historical marker #when migrating #then the explicit 1000 cap and user comment survive", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-subagent-limit-unrelated-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"# User note: see openai/codex#26753 for background",
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		sessionModel: "gpt-5.6-sol",
	});

	const content = await readFile(configPath, "utf8");
	assert.match(content, /# User note: see openai\/codex#26753 for background/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given gpt-5.6 session model with no models_cache #when migrating #then preserves existing concurrency values", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-subagent-limit-gpt56-nocache-"),
	);
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
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);

	const result = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		sessionModel: "gpt-5.6-sol",
	});

	const content = await readFile(configPath, "utf8");
	assert.equal(result.changed, true);
	assert.match(content, /^\s*max_threads\s*=\s*1000$/m);
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given config without any model #when migrating #then does not introduce agents.max_threads", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-subagent-limit-no-model-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model_reasoning_effort = "high"',
			"",
			"[agents]",
			"max_depth = 4",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_depth = 4/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
});

test("#given config without any model but an existing low cap #when migrating #then preserves the user cap", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-subagent-limit-no-model-raise-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model_reasoning_effort = "high"',
			"",
			"[agents]",
			"max_threads = 6",
			"max_depth = 4",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.match(content, /max_threads = 6/);
	assert.doesNotMatch(content, /max_threads = 1000/);
	assert.match(content, /max_depth = 4/);
});
