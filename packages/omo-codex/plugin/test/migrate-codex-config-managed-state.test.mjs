import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given managed config state is malformed #when migrating #then migration ignores stale state safely", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-config-malformed-state-"),
	);
	const codexHome = join(root, "codex-home");
	const statePath = join(root, "model-state.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(statePath, "[broken-json");
	await writeFile(
		join(codexHome, "config.toml"),
		'model = "gpt-5.5"\nmodel_context_window = 272000\n',
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: statePath,
		},
		cwd: root,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	const state = JSON.parse(await readFile(statePath, "utf8"));
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(content, /model_context_window = 372000/);
	assert.equal(state.files[join(codexHome, "config.toml")].managed, true);
});

test("#given managed config state path has surrounding whitespace #when migrating #then trimmed state path is used", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-trimmed-state-"));
	const codexHome = join(root, "codex-home");
	const statePath = join(root, "model-state.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		'model = "gpt-5.5"\nmodel_context_window = 272000\n',
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: `  ${statePath}  `,
		},
		cwd: root,
	});

	const state = JSON.parse(await readFile(statePath, "utf8"));
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.equal(state.files[join(codexHome, "config.toml")].managed, true);
});
