import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given model catalog is unavailable and stale 272k config #when migrating #then fallback catalog still upgrades it", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-config-fallback-catalog-"),
	);
	const codexHome = join(root, "codex-home");
	const missingCatalog = join(root, "missing-model-catalog.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		'model = "gpt-5.5"\nmodel_context_window = 272000\n',
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_PATH: missingCatalog,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(content, /model = "gpt-5\.6-sol"/);
	assert.match(content, /model_context_window = 372000/);
});

test("#given model catalog is malformed and stale config #when migrating #then fallback catalog still upgrades it", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-config-malformed-catalog-"),
	);
	const codexHome = join(root, "codex-home");
	const catalogPath = join(root, "model-catalog.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(catalogPath, "{not-json");
	await writeFile(
		join(codexHome, "config.toml"),
		'model = "gpt-5.5"\nmodel_context_window = 272000\n',
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_PATH: catalogPath,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(content, /model = "gpt-5\.6-sol"/);
	assert.match(content, /model_context_window = 372000/);
});
