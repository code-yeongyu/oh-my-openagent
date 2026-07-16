import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";
import { parseToml } from "./parse-toml.mjs";

test("#given a V2 session with stale runtime config #when migration runs #then disk config uses the safe pair and managed hint", async (t) => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-multi-agent-v2-safe-pair-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const codexHome = join(root, "codex-home");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			'model_reasoning_effort = "high"',
			"",
			"[agents]",
			"max_threads = 1000",
			"max_depth = 2",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"hide_spawn_agent_metadata = true",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [
				{ slug: "gpt-5.5", multi_agent_version: "v1" },
				{ slug: "gpt-5.6-sol", multi_agent_version: "v2" },
			],
		}),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
		sessionModel: "gpt-5.6-sol",
		requireSessionModel: true,
	});

	const content = await readFile(configPath, "utf8");
	const v2 = parseToml(content).features.multi_agent_v2;
	assert.deepEqual(result.changed, [configPath]);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.ok(v2.multi_agent_mode_hint_text.trim().length > 0);
	assert.equal("enabled" in v2, false);
	assert.match(content, /^\s*max_threads\s*=\s*1000$/m);
	assert.match(content, /max_depth = 2/);
});
