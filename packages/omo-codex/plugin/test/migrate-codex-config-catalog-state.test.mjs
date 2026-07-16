import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given managed catalog state #when catalog version advances #then only previously managed config is updated", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-catalog-state-"));
	const codexHome = join(root, "codex-home");
	const catalogPath = join(root, "catalog.json");
	const statePath = join(root, "model-state.json");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"model_context_window = 1000000",
			'model_reasoning_effort = "high"',
			'plan_mode_reasoning_effort = "xhigh"',
			"",
		].join("\n"),
	);
	await writeFile(
		catalogPath,
		JSON.stringify(
			{
				version: "test.v1",
				current: {
					model: "gpt-5.4",
					model_context_window: 1000000,
					model_reasoning_effort: "high",
					plan_mode_reasoning_effort: "xhigh",
				},
				managedProfiles: [],
			},
			null,
			2,
		),
	);

	const first = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_PATH: catalogPath,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: statePath,
		},
		cwd: root,
	});
	await writeFile(
		catalogPath,
		JSON.stringify(
			{
				version: "test.v2",
				current: {
					model: "gpt-5.5",
					model_context_window: 400000,
					model_reasoning_effort: "high",
					plan_mode_reasoning_effort: "xhigh",
				},
				managedProfiles: [],
			},
			null,
			2,
		),
	);
	const second = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_PATH: catalogPath,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: statePath,
		},
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(first.changed, [configPath]);
	assert.deepEqual(second.changed, [configPath]);
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
});

test("#given config already matches current catalog #when catalog version advances for role-only changes #then managed state is preserved", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-config-current-managed-"),
	);
	const codexHome = join(root, "codex-home");
	const catalogPath = join(root, "catalog.json");
	const statePath = join(root, "model-state.json");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"model_context_window = 400000",
			'model_reasoning_effort = "high"',
			'plan_mode_reasoning_effort = "xhigh"',
			'multi_agent_mode = "proactive"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"",
		].join("\n"),
	);
	await writeFile(
		catalogPath,
		JSON.stringify(
			{
				version: "test.role-only",
				current: {
					model: "gpt-5.5",
					model_context_window: 400000,
					model_reasoning_effort: "high",
					plan_mode_reasoning_effort: "xhigh",
				},
				roles: {
					verifier: { model: "gpt-5.5", model_reasoning_effort: "high" },
				},
				managedProfiles: [],
			},
			null,
			2,
		),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_PATH: catalogPath,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: statePath,
		},
		cwd: root,
	});

	const state = JSON.parse(await readFile(statePath, "utf8"));
	assert.deepEqual(result.changed, [configPath]);
	assert.deepEqual(result.modeChanged, [configPath]);
	assert.equal(state.files[configPath].managed, true);
	assert.equal(state.files[configPath].catalogVersion, "test.role-only");
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
});
