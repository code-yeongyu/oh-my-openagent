import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";
import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";
import { parseToml as parseTomlWithPython } from "./parse-toml.mjs";

test("#given multi_agent_v2 enabled #when forcing disable #then flips the flag to false", () => {
	const config = [
		'model = "gpt-5.5"',
		'model_reasoning_effort = "high"',
		"",
		"[features.multi_agent_v2]",
		"enabled = true",
		"max_concurrent_threads_per_session = 10000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /enabled = false/);
	assert.doesNotMatch(result, /enabled = true/);
	assert.match(result, /max_concurrent_threads_per_session = 10000/);
});

test("#given no multi_agent_v2 section #when forcing disable #then appends a disabled section", () => {
	const config = [
		'model = "gpt-5.5"',
		'model_reasoning_effort = "high"',
		"",
		"[features]",
		"plugins = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /plugins = true/);
});

test("#given multi_agent_v2 section without enabled key #when forcing disable #then inserts enabled = false", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features.multi_agent_v2]",
		"max_concurrent_threads_per_session = 10000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /max_concurrent_threads_per_session = 10000/);
});

test("#given [features] boolean shorthand multi_agent_v2 = true #when forcing disable #then removes it and appends a disabled section", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features]",
		"plugins = true",
		"multi_agent_v2 = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.doesNotMatch(result, /^multi_agent_v2\s*=/m);
	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /plugins = true/);
});

test("#given multi_agent_v2 enabled #when forcing disable #then annotates the managed section with the upstream issue and opt-out", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features.multi_agent_v2]",
		"enabled = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /openai\/codex#26753/);
	assert.match(result, /LAZYCODEX_CONFIG_MIGRATION_DISABLED=1/);
	assert.match(result, /^#[^\n]*\n(?:#[^\n]*\n)*\[features\.multi_agent_v2\]/m);
});

test("#given no multi_agent_v2 section #when forcing disable #then annotates the appended section", () => {
	const config = ['model = "gpt-5.5"', ""].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /openai\/codex#26753/);
	assert.match(
		result,
		/^#[^\n]*\n(?:#[^\n]*\n)*\[features\.multi_agent_v2\]\nenabled = false\n/m,
	);
});

test("#given an annotated managed section #when forcing disable runs again #then does not duplicate the comment", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features.multi_agent_v2]",
		"enabled = true",
		"",
	].join("\n");

	const annotated = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
	});
	const rerun = forceDisableMultiAgentV2(
		`${annotated.replace("enabled = false", "enabled = true")}`,
		{ multiAgentVersion: null },
	);

	const markers = rerun.match(/openai\/codex#26753/g) ?? [];
	assert.equal(markers.length, 1);
	assert.match(rerun, /enabled = false/);
});

test("#given [features] boolean shorthand multi_agent_v2 = false #when forcing disable #then rewrites to the non-conflicting disabled table", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features]",
		"multi_agent_v2 = false",
		"plugins = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });
	const parsed = parseTomlWithPython(result);

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
	assert.equal(parsed.features.plugins, true);
	assert.equal(parsed.features.multi_agent_v2.enabled, false);
});

test("#given multi_agent_v2 already disabled #when forcing disable #then returns config unchanged", () => {
	const config = [
		'model = "gpt-5.5"',
		'model_reasoning_effort = "high"',
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"max_concurrent_threads_per_session = 10000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.equal(result, config);
});

test("#given global config without multi_agent_v2 section #when full migration runs #then writes a disabled section on disk", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-multi-agent-v2-guard-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		['model = "gpt-5.5"', 'model_reasoning_effort = "high"', ""].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	assert.deepEqual(result.changed, [configPath]);
	assert.deepEqual(result.modeChanged, []);
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
});

test("#given global config starts with inline-comment features table #when full migration runs #then root model inheritance stays intact", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-root-settings-inline-features-"),
	);
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		["[features] # keep comment", "plugins = true", ""].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);
	assert.equal("multi_agent_mode" in parsed, false);
	assert.equal("model" in parsed, false);
	assert.equal("model_context_window" in parsed, false);
	assert.equal("model_reasoning_effort" in parsed, false);
	assert.equal("plan_mode_reasoning_effort" in parsed, false);
	assert.equal(parsed.features.plugins, true);
	assert.equal("multi_agent_mode" in parsed.features, false);
	assert.equal("model" in parsed.features, false);
	assert.equal("model_context_window" in parsed.features, false);
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
	assert.match(content, /\[features\] # keep comment\nplugins = true/);
});
