import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { ensureCodexReasoningConfig, migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given stale root reasoning config #when ensuring config #then replaces stale values without duplicate keys", () => {
	const result = ensureCodexReasoningConfig(
		[
			'model = "gpt-5.2"',
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
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.2"\n');
	await writeFile(projectConfigTarget, 'model = "gpt-5.2"\nmodel_context_window = 272000\n');
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
	assert.match(await readFile(projectConfig, "utf8"), /model = "gpt-5\.2"/);
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
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.2"\n');
	await writeFile(realConfigSource, 'model = "gpt-5.2"\nmodel_context_window = 272000\n');
	await symlink(realConfigSource, projectConfig, "file");

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: project,
	});

	assert.deepEqual(result.changed, [join(codexHome, "config.toml")]);
	assert.match(await readFile(realConfigSource, "utf8"), /model = "gpt-5\.2"/);
});

test("#given global and project-local stale Codex configs #when migrating #then both configs are forced to current defaults", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-config-migration-"));
	const codexHome = join(root, "codex-home");
	const project = join(root, "project", "nested");
	const projectConfig = join(root, "project", ".codex", "config.toml");
	await mkdir(codexHome, { recursive: true });
	await mkdir(dirname(projectConfig), { recursive: true });
	await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.2"\n');
	await writeFile(projectConfig, 'model = "gpt-5.2"\nmodel_context_window = 272000\n');

	const result = await migrateCodexConfig({
		env: { CODEX_HOME: codexHome, LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json") },
		cwd: project,
	});

	assert.deepEqual(result.changed.sort(), [join(codexHome, "config.toml"), projectConfig].sort());
	assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /model = "gpt-5\.5"/);
	assert.match(await readFile(projectConfig, "utf8"), /model_context_window = 400000/);
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
