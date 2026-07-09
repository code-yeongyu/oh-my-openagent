// allow: SIZE_OK - migration scenarios share one temp Codex-home harness across legacy TOML shapes; this release only adds config cases and future additions should split by migration family.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { removeUnsupportedRootMultiAgentMode } from "../scripts/migrate-codex-config/multi-agent-mode-guard.mjs";
import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";
import { ensureCodexReasoningConfig, migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

function parseTomlWithPython(config) {
	const python = resolvePython();
	const result = spawnSync(
		python,
		[
			"-c",
			[
				"import json, sys, tomllib",
				"print(json.dumps(tomllib.loads(sys.stdin.read())))",
			].join("; "),
		],
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
	assert.match(result, /model = "gpt-5\.5"/);
	assert.match(result, /model_context_window = 400000/);
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

	assert.match(result, /^model = "gpt-5\.5"$/m);
	assert.match(result, /^model_context_window = 400000$/m);
	assert.match(result, /\[model_providers\.openai\]\nmodel = "provider-scoped-value"\nmodel_context_window = 123456/);
	assert.match(result, /\[profiles\.review\]\nmodel_reasoning_effort = "medium"\nplan_mode_reasoning_effort = "medium"/);
});

test("#given project .codex is a symlink #when migrating #then project config is skipped", async (t) => {
	if (!(await canCreateSymlink("dir"))) t.skip("symbolic links are unavailable in this environment");

	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-symlink-dir-"));
	const codexHome = join(root, "codex-home");
	const project = join(root, "project");
	const projectNested = join(project, "nested");
	const projectCodexDirectory = join(root, "project-codex-real");
	const projectConfigTarget = join(projectCodexDirectory, "config.toml");
	const projectConfig = join(project, ".codex", "config.toml");

	await mkdir(codexHome, { recursive: true });
	await mkdir(projectCodexDirectory, { recursive: true });
	await mkdir(dirname(projectConfigTarget), { recursive: true });
	await mkdir(projectNested, { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');
	await writeFile(projectConfigTarget, 'model = "gpt-5.4"\nmodel_context_window = 272000\n');
	await rm(join(project, ".codex"), { recursive: true, force: true });
	await symlink(projectCodexDirectory, join(project, ".codex"), "dir");

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: projectNested,
	});

	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(await readFile(projectConfig, "utf8"), /model = "gpt-5\.4"/);
});

test("#given project config.toml is a symlink #when migrating #then project config is skipped", async (t) => {
	if (!(await canCreateSymlink("file"))) t.skip("symbolic links are unavailable in this environment");

	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-symlink-file-"));
	const codexHome = join(root, "codex-home");
	const project = join(root, "project");
	const projectConfigDirectory = join(project, ".codex");
	const projectConfig = join(projectConfigDirectory, "config.toml");
	const realConfigSource = join(root, "shared-config.toml");

	await mkdir(codexHome, { recursive: true });
	await mkdir(projectConfigDirectory, { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');
	await writeFile(realConfigSource, 'model = "gpt-5.4"\nmodel_context_window = 272000\n');
	await symlink(realConfigSource, projectConfig, "file");

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: project,
	});

	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(await readFile(realConfigSource, "utf8"), /model = "gpt-5\.4"/);
});

test("#given global and project-local stale Codex configs #when migrating #then both configs are forced to current defaults", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-migration-"));
	const codexHome = join(root, "codex-home");
	const project = join(root, "project", "nested");
	const projectConfig = join(root, "project", ".codex", "config.toml");
	await mkdir(codexHome, { recursive: true });
	await mkdir(dirname(projectConfig), { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');
	await writeFile(projectConfig, 'model = "gpt-5.5"\nmodel_context_window = 272000\n');

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: project,
	});

	assert.deepEqual(result.changed.sort(), [join(codexHome, "config.toml"), projectConfig].sort());
	assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /model = "gpt-5\.5"/);
	assert.match(await readFile(projectConfig, "utf8"), /model_context_window = 400000/);
});

test("#given model catalog is unavailable and stale 272k config #when migrating #then fallback catalog still upgrades it", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-fallback-catalog-"));
	const codexHome = join(root, "codex-home");
	const missingCatalog = join(root, "missing-model-catalog.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');

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
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
});

test("#given model catalog is malformed and stale config #when migrating #then fallback catalog still upgrades it", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-malformed-catalog-"));
	const codexHome = join(root, "codex-home");
	const catalogPath = join(root, "model-catalog.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(catalogPath, "{not-json");
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');

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
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
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
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.deepEqual(result.modeChanged, []);
	assert.match(content, /model = "gpt-5\.4"/);
	assert.match(content, /model_context_window = 123456/);
	assert.match(content, /model_reasoning_effort = "medium"/);
	assert.match(content, /plan_mode_reasoning_effort = "medium"/);
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
	assert.match(content, /\[agents\][\s\S]*?max_threads = 1000/);
	assert.match(content, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given managed config state is malformed #when migrating #then migration ignores stale state safely", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-malformed-state-"));
	const codexHome = join(root, "codex-home");
	const statePath = join(root, "model-state.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(statePath, "[broken-json");
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: statePath },
		cwd: root,
	});

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	const state = JSON.parse(await readFile(statePath, "utf8"));
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(content, /model_context_window = 400000/);
	assert.equal(state.files[join(codexHome, "config.toml")].managed, true);
});

test("#given managed config state path has surrounding whitespace #when migrating #then trimmed state path is used", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-trimmed-state-"));
	const codexHome = join(root, "codex-home");
	const statePath = join(root, "model-state.json");
	await mkdir(codexHome, { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nmodel_context_window = 272000\n');

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: `  ${statePath}  ` },
		cwd: root,
	});

	const state = JSON.parse(await readFile(statePath, "utf8"));
	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.equal(state.files[join(codexHome, "config.toml")].managed, true);
});

test("#given managed catalog state #when catalog version advances #then only previously managed config is updated", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-catalog-state-"));
	const codexHome = join(root, "codex-home");
	const catalogPath = join(root, "catalog.json");
	const statePath = join(root, "model-state.json");
	await mkdir(codexHome, { recursive: true });
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

	const content = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.deepEqual(first.changed, [join(codexHome, "config.toml")]);
	assert.deepEqual(second.changed, [join(codexHome, "config.toml")]);
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
});

test("#given config already matches current catalog #when catalog version advances for role-only changes #then managed state is preserved", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-current-managed-"));
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
				roles: { verifier: { model: "gpt-5.5", model_reasoning_effort: "high" } },
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
	assert.match(content, /\[agents\][\s\S]*?max_threads = 1000/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given stale Context7 placeholder MCP config #when migrating #then removes it and keeps plugin policy", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-context7-placeholder-cleanup-"));
	const codexHome = join(root, "codex-home");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"model_context_window = 400000",
			'model_reasoning_effort = "high"',
			'plan_mode_reasoning_effort = "xhigh"',
			"",
			"[mcp_servers.context7] # stale npx package from old docs",
			'command = "npx"',
			'args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]',
			"startup_timeout_sec = 20",
			"",
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
			"enabled = true",
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(result.changed, [configPath]);
	assert.doesNotMatch(content, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(content, /@upstash\/context7-mcp/);
	assert.doesNotMatch(content, /YOUR_API_KEY/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/);
});

test("#given real Context7 API key and placeholder comment #when migrating #then preserves user server settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-context7-real-key-"));
	const codexHome = join(root, "codex-home");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"model_context_window = 400000",
			'model_reasoning_effort = "high"',
			'plan_mode_reasoning_effort = "xhigh"',
			"",
			"[mcp_servers.context7]",
			'command = "npx"',
			'args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_live_example"] # replace YOUR_API_KEY in docs only',
			"startup_timeout_sec = 20",
			"",
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
			"enabled = true",
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(result.changed, [configPath]);
	assert.match(content, /\[mcp_servers\.context7\]/);
	assert.match(content, /ctx7sk_live_example/);
	assert.match(content, /replace YOUR_API_KEY in docs only/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/);
});

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
	assert.match(result, /^#[^\n]*\n(?:#[^\n]*\n)*\[features\.multi_agent_v2\]\nenabled = false\n/m);
});

test("#given an annotated managed section #when forcing disable runs again #then does not duplicate the comment", () => {
	const config = ['model = "gpt-5.5"', "", "[features.multi_agent_v2]", "enabled = true", ""].join("\n");

	const annotated = forceDisableMultiAgentV2(config, { multiAgentVersion: null });
	const rerun = forceDisableMultiAgentV2(`${annotated.replace("enabled = false", "enabled = true")}`, { multiAgentVersion: null });

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
		[
			'model = "gpt-5.5"',
			'model_reasoning_effort = "high"',
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	assert.deepEqual(result.changed, [configPath]);
	assert.deepEqual(result.modeChanged, []);
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[features\.multi_agent_v2\][\s\S]*?enabled = false/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
	assert.match(content, /\[agents\][\s\S]*?max_threads = 1000/);
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
});

test("#given global config starts with inline-comment features table #when full migration runs #then managed root settings stay at TOML root", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-root-settings-inline-features-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			"[features] # keep comment",
			"plugins = true",
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);
	assert.equal("multi_agent_mode" in parsed, false);
	assert.equal(parsed.model, "gpt-5.5");
	assert.equal(parsed.model_context_window, 400000);
	assert.equal(parsed.model_reasoning_effort, "high");
	assert.equal(parsed.plan_mode_reasoning_effort, "xhigh");
	assert.equal(parsed.features.plugins, true);
	assert.equal("multi_agent_mode" in parsed.features, false);
	assert.equal("model" in parsed.features, false);
	assert.equal("model_context_window" in parsed.features, false);
	assert.match(content, /^model = "gpt-5\.5"\nmodel_context_window = 400000/m);
	assert.doesNotMatch(content, /^\s*multi_agent_mode\s*=/m);
	assert.match(content, /\[features\] # keep comment\nplugins = true/);
});

test("#given queue multi-agent mode #when removing unsupported root key #then deletes root setting", () => {
	const config = ['multi_agent_mode = "queue"', "", "[features]", "multi_agent = true", ""].join("\n");

	const result = removeUnsupportedRootMultiAgentMode(config);

	assert.doesNotMatch(result, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(result, /multi_agent_mode = "queue"/);
	assert.match(result, /\[features\]/);
});

test("#given proactive multi-agent mode #when removing unsupported root key #then deletes root setting", () => {
	const config = ['multi_agent_mode = "proactive" # user already opted in', "", "[features]", "multi_agent = true", ""].join("\n");

	const result = removeUnsupportedRootMultiAgentMode(config);

	assert.doesNotMatch(result, /^\s*multi_agent_mode\s*=/m);
	assert.match(result, /\[features\]/);
});

test("#given inline-comment features table #when removing unsupported root key #then config stays unchanged", () => {
	const config = ["[features] # keep comment", "multi_agent = true", ""].join("\n");

	const result = removeUnsupportedRootMultiAgentMode(config);
	const parsed = parseTomlWithPython(result);

	assert.equal(result, config);
	assert.equal("multi_agent_mode" in parsed, false);
	assert.equal(parsed.features.multi_agent, true);
});

test("#given indented root proactive mode #when removing unsupported root key #then no root setting remains", () => {
	const config = ['  multi_agent_mode = "proactive" # user already opted in', "", "[features] # keep comment", "multi_agent = true", ""].join("\n");

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
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	assert.match(content, /enabled = false/);
	assert.doesNotMatch(content, /enabled = true/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
	assert.match(content, /\[agents\][\s\S]*?max_threads = 1000/);
});

test("#given enabled = true with an inline comment #when forcing disable #then flips to false and preserves the comment", () => {
	const config = ["[features.multi_agent_v2]", "enabled = true # tuned by me", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /^enabled = false # tuned by me$/m);
	assert.doesNotMatch(result, /enabled = true/);
	assert.equal((result.match(/^\s*enabled\s*=/gm) ?? []).length, 1);
	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
});

test("#given a section header with an inline comment #when forcing disable #then patches in place without duplicating the table", () => {
	const config = ["[features.multi_agent_v2] # pinned by me", "enabled = true", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
	assert.match(result, /enabled = false/);
	assert.doesNotMatch(result, /enabled = true/);
	assert.match(result, /# pinned by me/);
});

test("#given an already-guarded commented config #when re-running #then output is byte-identical", () => {
	const configA = ["[features.multi_agent_v2]", "enabled = true # tuned by me", ""].join("\n");
	const configB = ["[features.multi_agent_v2] # pinned by me", "enabled = true", ""].join("\n");

	const firstA = forceDisableMultiAgentV2(configA, { multiAgentVersion: null });
	const rerunA = forceDisableMultiAgentV2(firstA, { multiAgentVersion: null });
	assert.equal(rerunA, firstA);

	const firstB = forceDisableMultiAgentV2(configB, { multiAgentVersion: null });
	const rerunB = forceDisableMultiAgentV2(firstB, { multiAgentVersion: null });
	assert.equal(rerunB, firstB);
});

test("#given user-disabled with an inline comment #when forcing disable #then returns config unchanged", () => {
	const config = ["[features.multi_agent_v2]", "enabled = false # I turned this off myself", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.equal(result, config);
});

test("#given [features] shorthand true with an inline comment #when forcing disable #then removes the shorthand and appends one disabled table", () => {
	const config = ["[features]", "plugins = true", "multi_agent_v2 = true # legacy", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /plugins = true/);
});

test("#given a following section header with an inline comment #when inserting enabled=false #then does not leak into the next section", () => {
	const config = [
		"[features.multi_agent_v2]",
		"max_concurrent_threads_per_session = 2",
		"[mcp_servers.x] # note",
		"enabled = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: null });

	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /\[mcp_servers\.x\][^\n]*\nenabled = true/);
});

test("#given gpt-5.6-terra with managed disable #when model catalog prefers v2 #then clears enabled=false and managed comments", () => {
	const config = [
		'model = "gpt-5.6-terra"',
		"",
		"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
		"# because enabling it fails every turn with HTTP 400 (openai/codex#26753).",
		"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).",
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });

	assert.doesNotMatch(result, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(result, /openai\/codex#26753/);
	assert.doesNotMatch(result, /Managed by LazyCodex: multi_agent_v2/);
	assert.match(result, /\[features\.multi_agent_v2\]/);
	assert.match(result, /max_concurrent_threads_per_session = 1000/);
});

test("#given gpt-5.6-sol with no multi_agent_v2 section #when model catalog prefers v2 #then does not append a disable", () => {
	const config = ['model = "gpt-5.6-sol"', "", "[features]", "plugins = true", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });

	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
	assert.doesNotMatch(result, /enabled = false/);
	assert.match(result, /plugins = true/);
});

test("#given gpt-5.6-terra managed disable #when full migration sees models_cache v2 #then clears disable and drops agents.max_threads", async () => {
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
			"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
			"# because enabling it fails every turn with HTTP 400 (openai/codex#26753).",
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
	await writeFile(
		join(codexHome, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "gpt-5.6-terra", multi_agent_version: "v2" }],
		}),
	);

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
	});

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(content, /openai\/codex#26753/);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_depth = 2/);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

test("#given config default gpt-5.5 #when SessionStart model is gpt-5.6-terra #then prefers session model and clears disable", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		sessionModel: "gpt-5.6-terra",
		multiAgentVersion: "v2",
	});

	assert.doesNotMatch(result, /^\s*enabled\s*=\s*false/m);
	assert.match(result, /max_concurrent_threads_per_session = 1000/);
});

test("#given SessionStart without model #when requireSessionModel is set #then skips legacy force-disable", () => {
	const config = ['model = "gpt-5.5"', "", "[features]", "plugins = true", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.equal(result, config);
	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
});

test("#given legacy [features] shorthand #when requireSessionModel skips force-disable #then still removes the shorthand", () => {
	const config = ['model = "gpt-5.5"', "", "[features]", "plugins = true", "multi_agent_v2 = true", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.match(result, /plugins = true/);
	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
});

test("#given legacy [features] shorthand #when session model has no catalog entry #then still removes the shorthand", () => {
	const config = ['model = "gpt-5.5"', "", "[features]", "multi_agent_v2 = false", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		sessionModel: "gpt-5.7-nova",
	});

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
});

test("#given legacy shorthand and no session model on hook path #when full migration runs #then output stays valid TOML", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-multi-agent-v2-shorthand-hook-"));
	const codexHome = join(root, "codex-home");
	await mkdir(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		['model = "gpt-5.5"', 'model_reasoning_effort = "high"', "", "[features]", "plugins = true", "multi_agent_v2 = true", ""].join("\n"),
	);

	await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
		sessionModel: null,
		requireSessionModel: true,
	});

	const content = await readFile(configPath, "utf8");
	const parsed = parseTomlWithPython(content);
	assert.doesNotMatch(content, /^\s*multi_agent_v2\s*=\s*(?:true|false)/m);
	assert.equal(parsed.features.plugins, true);
	assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 1000);
	assert.equal("enabled" in parsed.features.multi_agent_v2, false);
});

test("#given config default gpt-5.5 #when full migration gets SessionStart gpt-5.6-terra #then clears disable using session model", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-multi-agent-v2-session-model-"));
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
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: root,
		sessionModel: "gpt-5.6-terra",
		requireSessionModel: true,
	});

	assert.deepEqual(result.changed, [configPath]);
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_concurrent_threads_per_session = 1000/);
});

async function canCreateSymlink(type) {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-symlink-capability-"));
	const target = join(root, "target");
	const link = join(root, "link");

	try {
		if (type === "dir") {
			await mkdir(target, { recursive: true });
			await symlink(target, link, "dir");
		} else {
			await writeFile(target, "");
			await symlink(target, link, "file");
		}

		await rm(link);
		await rm(target, { recursive: true, force: true });
		await rm(root, { recursive: true, force: true });
		return true;
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		if (!(error instanceof Error)) throw error;
		if (error.code === "EPERM" || error.code === "EEXIST") return false;
		return false;
	}
}
