import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";
import { parseToml as parseTomlWithPython } from "./parse-toml.mjs";

test("#given gpt-5.6-terra managed disable #when full migration sees models_cache v2 #then clears managed V2 state and preserves agents.max_threads", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-multi-agent-v2-gpt56-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-terra"',
			'model_reasoning_effort = "xhigh"',
			"",
			"[agents]",
			"max_threads = 1000",
			"max_depth = 2",
			"",
			"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
			"# because enabling it fails every turn with HTTP 400 (openai/codex#26753).",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "gpt-5.6-terra", multi_agent_version: "v2" }],
		}),
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
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(content, /openai\/codex#26753/);
	assert.match(content, /^\s*max_threads\s*=\s*1000$/m);
	assert.match(content, /max_depth = 2/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
});

test("#given legacy shorthand and no session model on hook path #when full migration runs #then output stays valid TOML", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-multi-agent-v2-shorthand-hook-"),
	);
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			'model_reasoning_effort = "high"',
			"",
			"[features]",
			"plugins = true",
			"multi_agent_v2 = true",
			"",
		].join("\n"),
	);

	await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
		sessionModel: null,
		requireSessionModel: true,
	});

	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);
	assert.doesNotMatch(content, /^\s*multi_agent_v2\s*=\s*(?:true|false)/m);
	assert.equal(parsed.features.plugins, true);
	assert.equal(
		"max_concurrent_threads_per_session" in parsed.features.multi_agent_v2,
		false,
	);
	assert.equal("enabled" in parsed.features.multi_agent_v2, false);
});

test("#given SoT migration failure #when hook migration runs #then config.toml repair still happens", async () => {
	const { runAutoUpdateCheck } = await import("../scripts/auto-update.mjs");
	const root = await mkdtemp(join(tmpdir(), "lazycodex-sot-isolation-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"",
		].join("\n"),
	);
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }],
		}),
	);
	// HOME pointing at a FILE makes migrateOmoSotConfig's mkdir(~/.omo) throw.
	const brokenHome = join(root, "not-a-dir");
	await writeFile(brokenHome, "");

	await runAutoUpdateCheck({
		env: {
			CODEX_HOME: codexHome,
			HOME: brokenHome,
			USERPROFILE: brokenHome,
			LAZYCODEX_AUTO_UPDATE_DISABLED: "1",
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
			LAZYCODEX_AUTO_UPDATE_STATE_PATH: join(root, "state.json"),
		},
		sessionModel: "gpt-5.6-sol",
		requireSessionModel: true,
	});

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
});

test("#given config default gpt-5.5 #when full migration gets SessionStart gpt-5.6-terra #then clears disable using session model", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-multi-agent-v2-session-model-"),
	);
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			'model_reasoning_effort = "high"',
			"",
			"[agents]",
			"max_threads = 1000",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n"),
	);
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [
				{ slug: "gpt-5.5", multi_agent_version: "v1" },
				{ slug: "gpt-5.6-terra", multi_agent_version: "v2" },
			],
		}),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
		sessionModel: "gpt-5.6-terra",
		requireSessionModel: true,
	});

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.match(content, /^\s*max_threads\s*=\s*1000$/m);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given user-modified config without root model #when full non-hook migration runs #then writes no disable and no new agents.max_threads", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-multi-agent-v2-desktop-no-model-"),
	);
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	// Codex Desktop sessions select the model in the UI; config.toml has no root
	// `model`, so migration cannot prove the session is not a GPT-5.6
	// reserved-schema model (#6002).
	await writeFile(
		configPath,
		[
			'model_reasoning_effort = "high"',
			"",
			"[features]",
			"plugins = true",
			"",
		].join("\n"),
	);

	await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(content, /openai\/codex#26753/);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session/);
});
