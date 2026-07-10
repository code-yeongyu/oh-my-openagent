import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateConfigFile } from "../scripts/migrate-codex-config.mjs";
import {
	ensureSubagentConcurrencyLimit,
	resolveSubagentThreadLimit,
} from "../scripts/migrate-codex-config/subagent-limit-guard.mjs";

test("#given SessionStart custom cap for a V2 model #when migrating #then writes 12 and removes agents.max_threads", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-custom-v2-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			"",
			"[agents]",
			"max_threads = 6",
			"",
			"[features.multi_agent_v2]",
			"max_concurrent_threads_per_session = 6",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root, LAZYCODEX_SUBAGENT_THREAD_LIMIT: "12" },
		sessionModel: "gpt-5.6-sol",
	});

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_concurrent_threads_per_session = 12/);
});

test("#given cap environment variables #when SessionStart resolves them #then canonical precedence, alias, bounds, and fallback are deterministic", () => {
	assert.equal(resolveSubagentThreadLimit({ OMO_CODEX_SUBAGENT_THREAD_LIMIT: "12" }), "12");
	assert.equal(
		resolveSubagentThreadLimit({
			LAZYCODEX_SUBAGENT_THREAD_LIMIT: "24",
			OMO_CODEX_SUBAGENT_THREAD_LIMIT: "12",
		}),
		"24",
	);
	assert.equal(resolveSubagentThreadLimit({ LAZYCODEX_SUBAGENT_THREAD_LIMIT: "1" }), "1");
	assert.equal(resolveSubagentThreadLimit({ LAZYCODEX_SUBAGENT_THREAD_LIMIT: "1000" }), "1000");
	assert.equal(
		resolveSubagentThreadLimit({
			LAZYCODEX_SUBAGENT_THREAD_LIMIT: "0",
			OMO_CODEX_SUBAGENT_THREAD_LIMIT: "12",
		}),
		"1000",
	);
	for (const invalid of ["0", "1001", "12.5"]) {
		assert.equal(resolveSubagentThreadLimit({ LAZYCODEX_SUBAGENT_THREAD_LIMIT: invalid }), "1000");
	}
});

test("#given ambient cap variables #when the direct SessionStart guard receives no env #then it keeps the default 1000", () => {
	const previousLazyCodexLimit = process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT;
	const previousOmoLimit = process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT;
	try {
		process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT = "12";
		process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT = "24";

		const content = ensureSubagentConcurrencyLimit('model = "gpt-5.5"\n', {
			multiAgentVersion: "v1",
		});

		assert.match(content, /max_threads = 1000/);
		assert.match(content, /max_concurrent_threads_per_session = 1000/);
		assert.doesNotMatch(content, /max_threads = 12/);
	} finally {
		if (previousLazyCodexLimit === undefined) delete process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT;
		else process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT = previousLazyCodexLimit;
		if (previousOmoLimit === undefined) delete process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT;
		else process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT = previousOmoLimit;
	}
});

test("#given SessionStart config migration sees a low subagent cap #when migrating #then raises it to 1000", async () => {
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
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
	assert.doesNotMatch(content, /^max_threads\s*=\s*6$/m);
});

test("#given gpt-5.6 session model with no models_cache #when migrating #then does not write agents.max_threads", async () => {
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
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
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
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
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
