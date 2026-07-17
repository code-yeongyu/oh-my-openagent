import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given relative model_catalog_json declares gpt-5.6 model as v1 #when migrating #then resolves catalog from config directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-v2-relative-catalog-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			'model_catalog_json = "custom-catalog.json"',
			"",
			"[agents]",
			"max_threads = 1000",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
		].join("\n"),
	);
	await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }] }));
	await writeFile(join(codexHome, "custom-catalog.json"), JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }] }));

	await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.match(content, /enabled = false/);
	assert.match(content, /max_threads = 1000/);
});

test("#given no SessionStart model and root gpt-5.6 model without catalog #when migrating #then clears stale V2 disable", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-v2-root-gpt56-nocache-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-terra"',
			"",
			"[agents]",
			"max_threads = 1000",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
		].join("\n"),
	);

	await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_concurrent_threads_per_session = 6/);
});
