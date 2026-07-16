import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given model_catalog_json declares a v2 model as v1 #when full migration runs #then keeps the managed disable and max_threads", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-multi-agent-v2-catalog-override-"),
	);
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	const catalogPath = join(root, "custom-catalog.json");
	// Codex Desktop user forces gpt-5.6-sol to v1 via an explicit replacement catalog.
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			`model_catalog_json = '${catalogPath}'`,
			"",
			"[agents]",
			"max_threads = 1000",
			"max_depth = 2",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);
	// models_cache.json STILL says v2 (stale), but the explicit catalog wins and says v1.
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }],
		}),
	);
	await writeFile(
		catalogPath,
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }],
		}),
	);

	await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.match(
		content,
		/enabled = false/,
		"explicit v1 catalog must keep the managed disable",
	);
	assert.match(
		content,
		/max_threads = 1000/,
		"explicit v1 catalog must keep agents.max_threads",
	);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
	assert.match(content, /max_depth = 2/);
});

test("#given model_catalog_json declares a model as v2 #when full migration runs #then clears the managed disable", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-multi-agent-v2-catalog-v2-"),
	);
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	const catalogPath = join(root, "custom-catalog.json");
	await writeFile(
		configPath,
		[
			'model = "custom-model"',
			`model_catalog_json = ${JSON.stringify(catalogPath)}`,
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"",
		].join("\n"),
	);
	await writeFile(
		catalogPath,
		JSON.stringify({
			models: [{ slug: "custom-model", multi_agent_version: "v2" }],
		}),
	);

	await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(
		content,
		/^\s*enabled\s*=\s*false/m,
		"explicit v2 catalog must clear the disable",
	);
});
