import assert from "node:assert/strict";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { repairNearestProjectLocalCodexArtifacts } from "./install-dist/install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

test("#given stale project-local Codex config #when Node installer runs #then repairs the local conflict", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();
	const projectRoot = await makeTempDir();
	const projectDirectory = join(projectRoot, "nested");
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");
	const projectConfigPath = join(projectRoot, ".codex", "config.toml");

	await mkdir(projectDirectory, { recursive: true });
	await mkdir(join(projectRoot, ".git"), { recursive: true });
	await mkdir(join(projectRoot, ".codex"), { recursive: true });
	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [{ name: "alpha", source: "./plugin" }],
	});
	await writePluginAt(pluginRoot, "alpha", "1.2.3");
	await writeFile(
		projectConfigPath,
		[
			"[features.multi_agent_v2]",
			"enabled = true",
			"",
			"[agents]",
			"  max_threads = 10",
			"max_depth = 4",
			"",
		].join("\n"),
	);

	const result = await installMarketplaceLocally({
		repoRoot,
		codexHome,
		binDir,
		projectDirectory,
		platform: "linux",
		runCommand: async (command, args, options) => {
			if (command === "npm" && args.join(" ") === "run build") {
				await mkdir(join(options.cwd, "dist"), { recursive: true });
				await writeFile(join(options.cwd, "dist", "cli.js"), "#!/usr/bin/env node\n");
			}
		},
		log: () => {},
	});

	assert.equal(result.projectCleanup.configPath, projectConfigPath);
	assert.equal(result.projectCleanup.changed, true);
	assert.deepEqual(result.projectCleanup.removedKeys, ["max_threads"]);
	assert.equal(result.projectCleanup.configs.length, 1);
	assert.match(await readFile(result.projectCleanup.backupPath, "utf8"), /max_threads = 10/);
	const content = await readFile(projectConfigPath, "utf8");
	assert.doesNotMatch(content, /^\s*max_threads\s*=/m);
	assert.match(content, /max_depth = 4/);
});

test("#given root and nested project-local Codex configs #when script cleanup runs #then it repairs every loaded project layer", async () => {
	const projectRoot = await makeTempDir();
	const projectDirectory = join(projectRoot, "nested");
	const rootConfigPath = join(projectRoot, ".codex", "config.toml");
	const nestedConfigPath = join(projectDirectory, ".codex", "config.toml");

	await mkdir(join(projectRoot, ".git"), { recursive: true });
	await mkdir(join(projectRoot, ".codex"), { recursive: true });
	await mkdir(join(projectDirectory, ".codex"), { recursive: true });
	await writeFile(join(projectDirectory, ".codex", "hooks.json"), "{}\n");
	await writeFile(
		rootConfigPath,
		[
			"[features.multi_agent_v2]",
			"enabled = true",
			"",
			"[agents]",
			"max_threads = 10",
			"max_depth = 4",
			"",
		].join("\n"),
	);
	await writeFile(
		nestedConfigPath,
		[
			"[features.multi_agent_v2]",
			"enabled = true",
			"",
			"[agents]",
			"job_max_runtime_seconds = 7200",
			"",
		].join("\n"),
	);

	const result = await repairNearestProjectLocalCodexArtifacts({
		startDirectory: projectDirectory,
		now: () => new Date("2026-06-01T01:02:03.004Z"),
	});

	assert.equal(result.projectRoot, projectRoot);
	assert.equal(result.changed, true);
	assert.equal(result.configPath, rootConfigPath);
	assert.deepEqual(
		result.configs.map((config) => config.configPath),
		[rootConfigPath, nestedConfigPath],
	);
	assert.deepEqual(
		result.configs.map((config) => config.changed),
		[true, false],
	);
	assert.equal(result.backupPath, `${rootConfigPath}.backup-2026-06-01T01-02-03-004Z`);
	const rootContent = await readFile(rootConfigPath, "utf8");
	const nestedContent = await readFile(nestedConfigPath, "utf8");
	assert.doesNotMatch(rootContent, /^max_threads\s*=/m);
	assert.match(rootContent, /max_depth = 4/);
	assert.match(nestedContent, /job_max_runtime_seconds = 7200/);
	assert.deepEqual(
		result.artifacts.map((artifact) => artifact.path).sort(),
		[join(projectDirectory, ".codex", "hooks.json")],
	);
});

test("#given no project-local config and CODEX_HOME in the parent chain #when script cleanup runs #then global Codex config is not treated as project state", async () => {
	const homeRoot = await makeTempDir();
	const codexHome = join(homeRoot, ".codex");
	const projectDirectory = join(homeRoot, "workspace", "nested");
	const globalConfigPath = join(codexHome, "config.toml");

	await mkdir(projectDirectory, { recursive: true });
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		globalConfigPath,
		[
			"[features.multi_agent_v2]",
			"enabled = true",
			"",
			"[agents]",
			"max_threads = 10",
			"max_depth = 4",
			"",
		].join("\n"),
	);

	const result = await repairNearestProjectLocalCodexArtifacts({ startDirectory: projectDirectory, codexHome });

	assert.equal(result.configPath, null);
	assert.equal(result.changed, false);
	const content = await readFile(globalConfigPath, "utf8");
	assert.match(content, /max_threads = 10/);
	assert.match(content, /max_depth = 4/);
});

test("#given project-local config is a symlink to CODEX_HOME #when script cleanup runs #then it skips the link without mutating the target", async () => {
	if (process.platform === "win32") return;

	const codexHome = await makeTempDir();
	const projectRoot = await makeTempDir();
	const globalConfigPath = join(codexHome, "config.toml");
	const projectConfigPath = join(projectRoot, ".codex", "config.toml");

	await mkdir(join(projectRoot, ".git"), { recursive: true });
	await mkdir(join(projectRoot, ".codex"), { recursive: true });
	await writeFile(
		globalConfigPath,
		[
			"[features.multi_agent_v2]",
			"enabled = true",
			"",
			"[agents]",
			"max_threads = 10",
			"max_depth = 4",
			"",
		].join("\n"),
	);
	await symlink(globalConfigPath, projectConfigPath);

	const result = await repairNearestProjectLocalCodexArtifacts({
		startDirectory: projectRoot,
		codexHome,
		now: () => new Date("2026-06-01T00:00:00Z"),
	});

	assert.equal(result.configPath, null);
	assert.equal(result.changed, false);
	assert.equal(await pathExists(`${projectConfigPath}.backup-2026-06-01T00-00-00-000Z`), false);
	const content = await readFile(globalConfigPath, "utf8");
	assert.match(content, /max_threads = 10/);
	assert.match(content, /max_depth = 4/);
});

test("#given project-local Codex config is a symlink #when script cleanup runs #then symlink target is not modified", async () => {
	if (process.platform === "win32") return;

	const projectRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const victimDir = await makeTempDir();
	const victimConfigPath = join(victimDir, "victim.toml");
	const projectConfigPath = join(projectRoot, `.codex`, "config.toml");
	const victimBefore = [
		"[features.multi_agent_v2]",
		"enabled=true",
		"",
		"[agents]",
		"max_threads=10",
		"max_depth=4",
		"",
	].join("\n");

	await mkdir(join(projectRoot, ".git"), { recursive: true });
	await mkdir(join(projectRoot, ".codex"), { recursive: true });
	await writeFile(victimConfigPath, victimBefore);
	await symlink(victimConfigPath, projectConfigPath);

	const result = await repairNearestProjectLocalCodexArtifacts({
		startDirectory: projectRoot,
		codexHome,
		now: () => new Date("2026-06-01T00:00:00Z"),
	});

	assert.equal(result.configPath, null);
	assert.equal(result.changed, false);
	assert.equal(result.backupPath, undefined);
	assert.equal(await pathExists(`${projectConfigPath}.backup-2026-06-01T00-00-00-000Z`), false);
	assert.equal(await readFile(victimConfigPath, "utf8"), victimBefore);
});

test("#given project-local .codex directory is a symlink #when script cleanup runs #then symlink target is not modified", async () => {
	if (process.platform === "win32") return;

	const projectRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const outsideCodexDir = await makeTempDir();
	const outsideConfigPath = join(outsideCodexDir, "config.toml");
	const projectCodexPath = join(projectRoot, ".codex");
	const outsideBefore = [
		"[features.multi_agent_v2]",
		"enabled=true",
		"",
		"[agents]",
		"max_threads=10",
		"max_depth=4",
		"",
	].join("\n");

	await mkdir(join(projectRoot, ".git"), { recursive: true });
	await mkdir(outsideCodexDir, { recursive: true });
	await writeFile(outsideConfigPath, outsideBefore);
	await symlink(outsideCodexDir, projectCodexPath);

	const result = await repairNearestProjectLocalCodexArtifacts({
		startDirectory: projectRoot,
		codexHome,
		now: () => new Date("2026-06-01T00:00:00Z"),
	});

	assert.equal(result.configPath, null);
	assert.equal(result.changed, false);
	assert.equal(result.backupPath, undefined);
	assert.equal(await pathExists(join(projectCodexPath, "config.toml.backup-2026-06-01T00-00-00-000Z")), false);
	assert.equal(await readFile(outsideConfigPath, "utf8"), outsideBefore);
});

test("#given malformed project directory from the environment #when script cleanup runs #then it skips project-local cleanup without failing install", async () => {
	const codexHome = await makeTempDir();

	const result = await repairNearestProjectLocalCodexArtifacts({
		startDirectory: `bad${"\0"}path`,
		codexHome,
	});

	assert.deepEqual(result, {
		projectRoot: null,
		configPath: null,
		changed: false,
		removedKeys: [],
		configs: [],
		artifacts: [],
	});
});

test("#given absent project directory from the script surface #when script cleanup runs #then it skips project-local cleanup without throwing", async () => {
	const codexHome = await makeTempDir();

	const result = await repairNearestProjectLocalCodexArtifacts({ codexHome });

	assert.deepEqual(result, {
		projectRoot: null,
		configPath: null,
		changed: false,
		removedKeys: [],
		configs: [],
		artifacts: [],
	});
});

test("#given project cleanup hits a filesystem edge #when Node installer runs #then install succeeds and reports skipped cleanup", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();
	const projectRoot = await makeTempDir();
	const projectDirectory = join(projectRoot, "not-a-directory");
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");
	const logs = [];

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [{ name: "alpha", source: "./plugin" }],
	});
	await writePluginAt(pluginRoot, "alpha", "1.2.3");
	await writeFile(projectDirectory, "file, not directory\n");

	const result = await installMarketplaceLocally({
		repoRoot,
		codexHome,
		binDir,
		projectDirectory,
		platform: "linux",
		runCommand: async (command, args, options) => {
			if (command === "npm" && args.join(" ") === "run build") {
				await mkdir(join(options.cwd, "dist"), { recursive: true });
				await writeFile(join(options.cwd, "dist", "cli.js"), "#!/usr/bin/env node\n");
			}
		},
		log: (message) => logs.push(message),
	});

	assert.equal(result.projectCleanup.projectRoot, null);
	assert.equal(result.projectCleanup.changed, false);
	assert.equal(logs.some((message) => message.includes("Skipped project-local Codex cleanup")), true);
	assert.equal(logs.some((message) => message.includes("not a directory")), true);
	assert.equal(await pathExists(join(codexHome, "config.toml")), true);
});

async function pathExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}
