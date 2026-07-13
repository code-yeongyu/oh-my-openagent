import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";

const ROUTING_SETTING =
	/(?:tool_namespace|hide_spawn_agent_metadata|multi_agent_mode_hint_text)\s*=/;

test("#given V1 explicit-unknown and no-session models #when guard runs #then only the no-session config gains the inert compatibility pair", () => {
	const v1 = forceDisableMultiAgentV2(v2Table('model = "gpt-5.5"'), {
		multiAgentVersion: "v1",
		sessionModel: "gpt-5.5",
	});
	const unknown = forceDisableMultiAgentV2(v2Table('model = "custom-model"'), {
		multiAgentVersion: null,
		sessionModel: "custom-model",
	});
	const noSession = forceDisableMultiAgentV2(
		v2Table("[features]", "enabled = true"),
		{
			multiAgentVersion: null,
			requireSessionModel: true,
			sessionModel: null,
		},
	);

	assert.doesNotMatch(v1, ROUTING_SETTING);
	assert.doesNotMatch(unknown, ROUTING_SETTING);
	assert.match(noSession, /^tool_namespace = "agents"$/m);
	assert.match(noSession, /^hide_spawn_agent_metadata = false$/m);
	assert.match(v1, /enabled = false/);
	assert.match(noSession, /enabled = true/);
});

test("#given only a nested agent model #when no session model exists #then nested settings stay intact and the compatibility pair is added", () => {
	const config = [
		'model_reasoning_effort = "high"',
		"",
		"[agents.custom]",
		'model = "gpt-5.6-terra"',
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		modelsCachePath: join(tmpdir(), "missing-models-cache.json"),
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.ok(result.startsWith(config.trimEnd()));
	assert.match(result, /^tool_namespace = "agents"$/m);
	assert.match(result, /^hide_spawn_agent_metadata = false$/m);
	assert.doesNotMatch(result, /^enabled\s*=/m);
	assert.doesNotMatch(result, /^max_concurrent_threads_per_session\s*=/m);
	assert.doesNotMatch(result, /^max_threads\s*=/m);
});

test("#given assignment-looking root settings inside a multiline string #when resolving #then prose never selects the model or catalog", () => {
	const config = [
		"notes = '''",
		'model = "gpt-5.6-sol"',
		'model_catalog_json = "redirect.json"',
		"'''",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.ok(result.startsWith(config.trimEnd()));
	assert.doesNotMatch(result, /^enabled\s*=/m);
	assert.match(result, /^tool_namespace = "agents"$/m);
});

test("#given quoted table names containing hash characters #when resolving root model #then nested settings never select V2", () => {
	for (const tableHeader of ['["agents#custom"]', "['agents#custom']"]) {
		const config = [
			'model_reasoning_effort = "high"',
			"",
			tableHeader,
			'model = "gpt-5.6-terra"',
			"",
		].join("\n");
		const result = forceDisableMultiAgentV2(config, {
			modelsCachePath: join(tmpdir(), "missing-models-cache.json"),
			requireSessionModel: true,
			sessionModel: null,
		});

		assert.ok(result.startsWith(config.trimEnd()));
		assert.match(result, /^tool_namespace = "agents"$/m);
		assert.match(result, /^hide_spawn_agent_metadata = false$/m);
		assert.doesNotMatch(result, /^enabled\s*=/m);
	}
});

test("#given a quoted hash table with a nested catalog #when resolving root catalog #then the root catalog remains authoritative", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-quoted-hash-catalog-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "custom-model", multi_agent_version: "v1" }],
		}),
	);
	await writeFile(
		join(codexHome, "nested-catalog.json"),
		JSON.stringify({
			models: [{ slug: "custom-model", multi_agent_version: "v2" }],
		}),
	);
	const config = [
		"model = 'custom-model'",
		"",
		'["agents#custom"]',
		"model_catalog_json = 'nested-catalog.json'",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		configPath: join(codexHome, "config.toml"),
		env: { CODEX_HOME: codexHome },
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.equal(result, config);
	assert.doesNotMatch(result, ROUTING_SETTING);
});

test("#given only a nested replacement catalog #when guard resolves the root model #then it ignores that catalog", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-nested-agent-catalog-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "custom-model", multi_agent_version: "v1" }],
		}),
	);
	await writeFile(
		join(codexHome, "nested-catalog.json"),
		JSON.stringify({
			models: [{ slug: "custom-model", multi_agent_version: "v2" }],
		}),
	);
	const config = [
		"model = 'custom-model'",
		"",
		"[agents.custom]",
		"model_catalog_json = 'nested-catalog.json'",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		configPath: join(codexHome, "config.toml"),
		env: { CODEX_HOME: codexHome },
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.equal(result, config);
	assert.doesNotMatch(result, ROUTING_SETTING);
});

function v2Table(root, setting = "max_concurrent_threads_per_session = 1000") {
	return [root, "", "[features.multi_agent_v2]", setting, ""].join("\n");
}
