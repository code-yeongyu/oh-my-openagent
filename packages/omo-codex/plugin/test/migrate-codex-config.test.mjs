import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";
import { ensureCodexReasoningConfig, migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

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

test("#given user-customized Codex model config #when migrating #then user values are preserved", async () => {
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
	assert.deepEqual(result.changed, []);
	assert.match(content, /model = "gpt-5\.4"/);
	assert.match(content, /model_context_window = 123456/);
	assert.match(content, /model_reasoning_effort = "medium"/);
	assert.match(content, /plan_mode_reasoning_effort = "medium"/);
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
	assert.deepEqual(result.changed, []);
	assert.equal(state.files[configPath].managed, true);
	assert.equal(state.files[configPath].catalogVersion, "test.role-only");
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

	const result = forceDisableMultiAgentV2(config);

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

	const result = forceDisableMultiAgentV2(config);

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

	const result = forceDisableMultiAgentV2(config);

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

	const result = forceDisableMultiAgentV2(config);

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

	const result = forceDisableMultiAgentV2(config);

	assert.match(result, /openai\/codex#26753/);
	assert.match(result, /LAZYCODEX_CONFIG_MIGRATION_DISABLED=1/);
	assert.match(result, /^#[^\n]*\n(?:#[^\n]*\n)*\[features\.multi_agent_v2\]/m);
});

test("#given no multi_agent_v2 section #when forcing disable #then annotates the appended section", () => {
	const config = ['model = "gpt-5.5"', ""].join("\n");

	const result = forceDisableMultiAgentV2(config);

	assert.match(result, /openai\/codex#26753/);
	assert.match(result, /^#[^\n]*\n(?:#[^\n]*\n)*\[features\.multi_agent_v2\]\nenabled = false\n/m);
});

test("#given an annotated managed section #when forcing disable runs again #then does not duplicate the comment", () => {
	const config = ['model = "gpt-5.5"', "", "[features.multi_agent_v2]", "enabled = true", ""].join("\n");

	const annotated = forceDisableMultiAgentV2(config);
	const rerun = forceDisableMultiAgentV2(`${annotated.replace("enabled = false", "enabled = true")}`);

	const markers = rerun.match(/openai\/codex#26753/g) ?? [];
	assert.equal(markers.length, 1);
	assert.match(rerun, /enabled = false/);
});

test("#given [features] boolean shorthand multi_agent_v2 = false #when forcing disable #then returns config unchanged", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features]",
		"multi_agent_v2 = false",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config);

	assert.equal(result, config);
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

	const result = forceDisableMultiAgentV2(config);

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
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[features\.multi_agent_v2\]\nenabled = false\n/);
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
});

test("#given enabled = true with an inline comment #when forcing disable #then flips to false and preserves the comment", () => {
	const config = ["[features.multi_agent_v2]", "enabled = true # tuned by me", ""].join("\n");

	const result = forceDisableMultiAgentV2(config);

	assert.match(result, /^enabled = false # tuned by me$/m);
	assert.doesNotMatch(result, /enabled = true/);
	assert.equal((result.match(/^\s*enabled\s*=/gm) ?? []).length, 1);
	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
});

test("#given a section header with an inline comment #when forcing disable #then patches in place without duplicating the table", () => {
	const config = ["[features.multi_agent_v2] # pinned by me", "enabled = true", ""].join("\n");

	const result = forceDisableMultiAgentV2(config);

	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
	assert.match(result, /enabled = false/);
	assert.doesNotMatch(result, /enabled = true/);
	assert.match(result, /# pinned by me/);
});

test("#given an already-guarded commented config #when re-running #then output is byte-identical", () => {
	const configA = ["[features.multi_agent_v2]", "enabled = true # tuned by me", ""].join("\n");
	const configB = ["[features.multi_agent_v2] # pinned by me", "enabled = true", ""].join("\n");

	const firstA = forceDisableMultiAgentV2(configA);
	const rerunA = forceDisableMultiAgentV2(firstA);
	assert.equal(rerunA, firstA);

	const firstB = forceDisableMultiAgentV2(configB);
	const rerunB = forceDisableMultiAgentV2(firstB);
	assert.equal(rerunB, firstB);
});

test("#given user-disabled with an inline comment #when forcing disable #then returns config unchanged", () => {
	const config = ["[features.multi_agent_v2]", "enabled = false # I turned this off myself", ""].join("\n");

	const result = forceDisableMultiAgentV2(config);

	assert.equal(result, config);
});

test("#given [features] shorthand true with an inline comment #when forcing disable #then removes the shorthand and appends one disabled table", () => {
	const config = ["[features]", "plugins = true", "multi_agent_v2 = true # legacy", ""].join("\n");

	const result = forceDisableMultiAgentV2(config);

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

	const result = forceDisableMultiAgentV2(config);

	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /\[mcp_servers\.x\][^\n]*\nenabled = true/);
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
