import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateConfigFile } from "../scripts/migrate-codex-config.mjs";

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
