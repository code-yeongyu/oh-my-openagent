import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	ensureCodexReasoningConfig,
	migrateCodexConfig,
} from "../scripts/migrate-codex-config.mjs";

test("#given stale root reasoning config #when ensuring config #then replaces stale values without duplicate keys", () => {
	const result = ensureCodexReasoningConfig(
		[
			'model = "gpt-5.5"',
			"model_context_window = 272000",
			'model_reasoning_effort = "low"',
			'plan_mode_reasoning_effort = "medium"',
			"",
			"[features]",
			"plugins = true",
			"",
		].join("\n"),
	);

	assert.equal(result.match(/^model\s*=/gm)?.length, 1);
	assert.equal(result.match(/^model_context_window\s*=/gm)?.length, 1);
	assert.equal(result.match(/^model_reasoning_effort\s*=/gm)?.length, 1);
	assert.equal(result.match(/^plan_mode_reasoning_effort\s*=/gm)?.length, 1);
	assert.match(result, /model = "gpt-5\.6-sol"/);
	assert.match(result, /model_context_window = 372000/);
	assert.match(result, /model_reasoning_effort = "high"/);
	assert.match(result, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(result, /gpt-5\.2/);
	assert.match(result, /\[features\]/);
});

test("#given section settings reuse managed root keys #when ensuring config #then section settings are preserved", () => {
	const result = ensureCodexReasoningConfig(
		[
			'model = "gpt-5.5"',
			"model_context_window = 272000",
			"",
			"[model_providers.openai]",
			'model = "provider-scoped-value"',
			"model_context_window = 123456",
			"",
			"[profiles.review]",
			'model_reasoning_effort = "medium"',
			'plan_mode_reasoning_effort = "medium"',
			"",
		].join("\n"),
	);

	assert.match(result, /^model = "gpt-5\.6-sol"$/m);
	assert.match(result, /^model_context_window = 372000$/m);
	assert.match(
		result,
		/\[model_providers\.openai\]\nmodel = "provider-scoped-value"\nmodel_context_window = 123456/,
	);
	assert.match(
		result,
		/\[profiles\.review\]\nmodel_reasoning_effort = "medium"\nplan_mode_reasoning_effort = "medium"/,
	);
});

test("#given global and project-local stale Codex configs #when migrating #then both configs are forced to current defaults", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-migration-"));
	const codexHome = join(root, "codex-home");
	const project = join(root, "project", "nested");
	const projectConfig = join(root, "project", ".codex", "config.toml");
	await mkdir(codexHome, { recursive: true });
	await mkdir(dirname(projectConfig), { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		'model = "gpt-5.5"\nmodel_context_window = 272000\n',
	);
	await writeFile(
		projectConfig,
		'model = "gpt-5.5"\nmodel_context_window = 272000\n',
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: project,
	});

	assert.deepEqual(
		result.changed.sort(),
		[join(codexHome, "config.toml"), projectConfig].sort(),
	);
	assert.match(
		await readFile(join(codexHome, "config.toml"), "utf8"),
		/model = "gpt-5\.6-sol"/,
	);
	assert.match(
		await readFile(projectConfig, "utf8"),
		/model_context_window = 372000/,
	);
});

test("#given user-customized Codex model config #when migrating #then user values are preserved without root multi-agent mode", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-custom-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		[
			'model = "gpt-5.4"',
			"model_context_window = 123456",
			'model_reasoning_effort = "medium"',
			'plan_mode_reasoning_effort = "medium"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.deepEqual(result.changed, []);
	assert.deepEqual(result.modeChanged, []);
	assert.match(content, /model = "gpt-5\.4"/);
	assert.match(content, /model_context_window = 123456/);
	assert.match(content, /model_reasoning_effort = "medium"/);
	assert.match(content, /plan_mode_reasoning_effort = "medium"/);
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
});
