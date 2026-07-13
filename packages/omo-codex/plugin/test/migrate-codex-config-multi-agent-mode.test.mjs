import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { removeUnsupportedRootMultiAgentMode } from "../scripts/migrate-codex-config/multi-agent-mode-guard.mjs";
import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";
import { parseToml as parseTomlWithPython } from "./parse-toml.mjs";

test("#given queue multi-agent mode #when removing unsupported root key #then deletes root setting", () => {
	const config = [
		'multi_agent_mode = "queue"',
		"",
		"[features]",
		"multi_agent = true",
		"",
	].join("\n");

	const result = removeUnsupportedRootMultiAgentMode(config);

	assert.doesNotMatch(result, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(result, /multi_agent_mode = "queue"/);
	assert.match(result, /\[features\]/);
});

test("#given proactive multi-agent mode #when removing unsupported root key #then deletes root setting", () => {
	const config = [
		'multi_agent_mode = "proactive" # user already opted in',
		"",
		"[features]",
		"multi_agent = true",
		"",
	].join("\n");

	const result = removeUnsupportedRootMultiAgentMode(config);

	assert.doesNotMatch(result, /^\s*multi_agent_mode\s*=/m);
	assert.match(result, /\[features\]/);
});

test("#given inline-comment features table #when removing unsupported root key #then config stays unchanged", () => {
	const config = ["[features] # keep comment", "multi_agent = true", ""].join(
		"\n",
	);

	const result = removeUnsupportedRootMultiAgentMode(config);
	const parsed = parseTomlWithPython(result);

	assert.equal(result, config);
	assert.equal("multi_agent_mode" in parsed, false);
	assert.equal(parsed.features.multi_agent, true);
});

test("#given indented root proactive mode #when removing unsupported root key #then no root setting remains", () => {
	const config = [
		'  multi_agent_mode = "proactive" # user already opted in',
		"",
		"[features] # keep comment",
		"multi_agent = true",
		"",
	].join("\n");

	const result = removeUnsupportedRootMultiAgentMode(config);

	assert.equal(result.match(/multi_agent_mode\s*=/g)?.length ?? 0, 0);
	assert.match(result, /^\[features\] # keep comment$/m);
});

test("#given global config with forced multi_agent_v2 #when full migration runs #then disables it on disk", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-multi-agent-v2-guard-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			'model_reasoning_effort = "high"',
			"",
			"[features.multi_agent_v2]",
			"enabled = true",
			"max_concurrent_threads_per_session = 10000",
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

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	assert.match(content, /enabled = false/);
	assert.doesNotMatch(content, /enabled = true/);
	assert.match(content, /^max_concurrent_threads_per_session = 10000$/m);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
});
