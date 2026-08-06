import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateConfigFile } from "../scripts/migrate-codex-config.mjs";

function parseTomlWithPython(config) {
	const python = resolvePython();
	const result = spawnSync(
		python,
		["-c", "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))"],
		{ encoding: "utf8", input: config },
	);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function resolvePython() {
	for (const command of ["python3", "python"]) {
		const result = spawnSync(command, ["-c", "import tomllib"], { encoding: "utf8" });
		if (result.status === 0) return command;
	}
	assert.fail("Python with tomllib is required for TOML parse assertions");
}

test("#given SessionStart migration sees an inline-commented V2 cap #when migrating twice #then preserves the line and ordering byte-for-byte", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-migration-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"model_context_window = 123456",
			'model_reasoning_effort = "medium"',
			'plan_mode_reasoning_effort = "medium"',
			"",
			"[agents]",
			"max_threads = 6",
			"max_depth = 4",
			"",
			"[agents.explorer]",
			'config_file = "./agents/explorer.toml"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"usage_hint_enabled = false",
			"max_concurrent_threads_per_session = 7 # user cap",
			"show_tool_use = false",
			"",
		].join("\n"),
	);

	const firstResult = await migrateConfigFile(configPath);
	const firstPass = await readFile(configPath, "utf8");
	const secondResult = await migrateConfigFile(configPath);

	const secondPass = await readFile(configPath, "utf8");
	assert.equal(firstResult.changed, true);
	assert.equal(secondResult.changed, false);
	assert.equal(secondPass, firstPass);
	assert.match(
		secondPass,
		/usage_hint_enabled = false\nmax_concurrent_threads_per_session = 7 # user cap\nshow_tool_use = false/,
	);
	assert.match(secondPass, /\[agents\][\s\S]*?max_threads = 1000/);
	assert.match(secondPass, /max_depth = 4/);
	assert.match(secondPass, /\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/);
	assert.match(secondPass, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.doesNotMatch(secondPass, /^max_threads\s*=\s*6$/m);
});

for (const header of [
	'["features"."multi_agent_v2"]',
	"[ features . multi_agent_v2 ]",
	'["features"."multi_agent_v\\u0032"]',
]) {
	test(`#given SessionStart migration sees equivalent V2 header ${header} #when migrating twice #then preserves one valid table and the explicit cap`, async () => {
		const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-equivalent-header-"));
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.4"',
				"",
				header,
				"usage_hint_enabled = false",
				"max_concurrent_threads_per_session = 7 # user cap",
				"show_tool_use = false",
				"",
			].join("\n"),
		);

		await migrateConfigFile(configPath);
		const firstPass = await readFile(configPath, "utf8");
		const parsed = parseTomlWithPython(firstPass);
		const secondResult = await migrateConfigFile(configPath);
		const secondPass = await readFile(configPath, "utf8");

		assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 7);
		assert.equal(secondResult.changed, false);
		assert.equal(secondPass, firstPass);
		assert.equal((secondPass.match(/max_concurrent_threads_per_session\s*=/g) ?? []).length, 1);
		assert.match(
			secondPass,
			/usage_hint_enabled = false\nmax_concurrent_threads_per_session = 7 # user cap\nshow_tool_use = false/,
		);
		assert.match(secondPass, new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	});
}

for (const fixture of [
	{
		name: "quoted cap key",
		lines: [
			"[features.multi_agent_v2]",
			'"max_concurrent_threads_per_session" = 7 # user cap',
		],
		preservedLine: '"max_concurrent_threads_per_session" = 7 # user cap',
	},
	{
		name: "escaped quoted cap key",
		lines: [
			"[features.multi_agent_v2]",
			'"max_concurrent_threads_per_sessio\\u006e" = 7 # user cap',
		],
		preservedLine: '"max_concurrent_threads_per_sessio\\u006e" = 7 # user cap',
	},
	{
		name: "dotted cap key",
		lines: [
			"[features]",
			"multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
		],
		preservedLine: "multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
	},
	{
		name: "root-qualified dotted cap key",
		lines: ["features.multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap"],
		preservedLine: "features.multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
	},
]) {
	test(`#given SessionStart migration sees a ${fixture.name} #when migrating twice #then preserves the semantic cap without duplication`, async () => {
		const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-semantic-key-"));
		const configPath = join(root, "config.toml");
		await writeFile(configPath, ['model = "gpt-5.4"', "", ...fixture.lines, ""].join("\n"));

		await migrateConfigFile(configPath);
		const firstPass = await readFile(configPath, "utf8");
		const parsed = parseTomlWithPython(firstPass);
		const secondResult = await migrateConfigFile(configPath);
		const secondPass = await readFile(configPath, "utf8");

		assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 7);
		assert.equal(secondResult.changed, false);
		assert.equal(secondPass, firstPass);
		assert.match(secondPass, new RegExp(fixture.preservedLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.doesNotMatch(secondPass, /^max_concurrent_threads_per_session = 16$/m);
		if (fixture.name === "root-qualified dotted cap key") {
			assert.equal(parsed.features.multi_agent_v2.enabled, false);
		}
	});
}

test("#given multiline string contains V2 cap lookalikes #when SessionStart migrates #then writes the absent semantic default", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-multiline-lookalike-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			'notes = """',
			"[features.multi_agent_v2]",
			"max_concurrent_threads_per_session = 7",
			'"""',
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath);
	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);

	assert.match(parsed.notes, /max_concurrent_threads_per_session = 7/);
	assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 16);
});

test("#given V2 section multiline value contains a cap lookalike #when SessionStart migrates #then writes the absent default", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-section-multiline-lookalike-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"[features.multi_agent_v2]",
			'notes = """',
			"max_concurrent_threads_per_session = 7",
			'"""',
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath);
	const parsed = parseTomlWithPython(await readFile(configPath, "utf8"));

	assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 16);
});

test("#given V2 root-dotted disable and cap #when gpt-5.6 SessionStart migrates #then removes disable and V1 agents cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-root-dotted-v2-cleanup-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-terra"',
			"features.multi_agent_v2.max_concurrent_threads_per_session = 7",
			"features.multi_agent_v2.enabled = false",
			"",
			"[agents]",
			"max_threads = 1000",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath, { sessionModel: "gpt-5.6-terra" });
	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);

	assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 7);
	assert.equal(parsed.features.multi_agent_v2.enabled, undefined);
	assert.equal(parsed.agents, undefined);
});

test("#given quoted dotted V1 keys under features #when SessionStart migrates #then replaces enabled without a duplicate", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-quoted-dotted-v1-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"",
			"[features]",
			'"multi_agent_v2".enabled = true',
			'"multi_agent_v2".max_concurrent_threads_per_session = 7',
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath);
	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);

	assert.equal(parsed.features.multi_agent_v2.enabled, false);
	assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 7);
	assert.equal((content.match(/enabled\s*=/g) ?? []).length, 1);
});

test("#given multiline string closes after an escaped quote #when SessionStart migrates #then preserves the following explicit cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-overlapping-closer-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			'notes = """abc\\\""""',
			"[features.multi_agent_v2]",
			"max_concurrent_threads_per_session = 7",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath);
	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);

	assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 7);
	assert.equal((content.match(/^\[features\.multi_agent_v2\]$/gm) ?? []).length, 1);
});

test("#given gpt-5.6 session model with no models_cache and an explicit V2 cap #when migrating #then removes agents.max_threads but preserves the cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-gpt56-nocache-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			'model_reasoning_effort = "xhigh"',
			"",
			"[agents]",
			"max_threads = 1000",
			"max_depth = 4",
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
		].join("\n"),
	);

	const result = await migrateConfigFile(configPath, {
		env: { CODEX_HOME: root },
		sessionModel: "gpt-5.6-sol",
	});

	const content = await readFile(configPath, "utf8");
	assert.equal(result.changed, true);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /max_concurrent_threads_per_session = 6/);
});

test("#given SessionStart config migration has no V2 cap #when migrating #then writes the conservative managed default", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-missing-cap-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.4"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"",
		].join("\n"),
	);

	await migrateConfigFile(configPath);

	const content = await readFile(configPath, "utf8");
	assert.match(content, /max_concurrent_threads_per_session = 16/);
	assert.doesNotMatch(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given config without any model #when migrating #then does not introduce agents.max_threads", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-no-model-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		['model_reasoning_effort = "high"', "", "[agents]", "max_depth = 4", ""].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_depth = 4/);
	assert.match(content, /max_concurrent_threads_per_session = 16/);
});

test("#given config without any model but an existing low cap #when migrating #then still raises the existing cap", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-subagent-limit-no-model-raise-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		['model_reasoning_effort = "high"', "", "[agents]", "max_threads = 6", "max_depth = 4", ""].join("\n"),
	);

	await migrateConfigFile(configPath, { env: { CODEX_HOME: root } });

	const content = await readFile(configPath, "utf8");
	assert.match(content, /max_threads = 1000/);
	assert.doesNotMatch(content, /max_threads = 6/);
	assert.match(content, /max_depth = 4/);
});
