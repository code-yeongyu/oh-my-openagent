import assert from "node:assert/strict";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

const legacyCodexPluginMarketplace = ["code", "yeongyu", "codex", "plugins"].join("-");

test(
	"#given bundled agent roles and stale legacy links #when installing locally #then installs durable Codex agent files",
	{ skip: process.platform === "win32" ? "test sets up a Unix legacy symlink fixture" : false },
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		for (const agentName of ["explorer", "librarian", "plan"]) {
			await writeFile(join(agentsRoot, `${agentName}.toml`), `name = "${agentName}"\n`);
		}
		await mkdir(join(codexHome, "agents"), { recursive: true });
		await symlink(
			join(codexHome, "plugins", "cache", legacyCodexPluginMarketplace, "omo", "0.1.0", "components", "ultrawork", "agents", "explorer.toml"),
			join(codexHome, "agents", "explorer.toml"),
		);

		const result = await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		assert.equal(result.installed.length, 1);
		const snapshotPluginPath = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo");
		for (const agentName of ["explorer", "librarian", "plan"]) {
			const agentPath = join(codexHome, "agents", `${agentName}.toml`);
			const agentStat = await lstat(agentPath);
			assert.equal(agentStat.isSymbolicLink(), false);
			assert.equal(agentStat.isFile(), true);
			assert.equal(await readFile(agentPath, "utf8"), `name = "${agentName}"\n`);
		}

		const installedAgents = JSON.parse(await readFile(join(snapshotPluginPath, ".installed-agents.json"), "utf8"));
		assert.deepEqual(installedAgents.agents.sort(), [
			join(codexHome, "agents", "explorer.toml"),
			join(codexHome, "agents", "librarian.toml"),
			join(codexHome, "agents", "plan.toml"),
		]);
	},
);

test(
	"#given local sisyphuslabs install #when plugin cache is pruned #then agent files still resolve from Codex home",
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		await writeFile(join(agentsRoot, "explorer.toml"), 'name = "explorer"\n');
		const snapshotRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs");
		await mkdir(join(snapshotRoot, ".git"), { recursive: true });
		await writeFile(join(snapshotRoot, ".git", "config"), "[remote \"origin\"]\n");
		await writeFile(join(snapshotRoot, ".codex-marketplace-install.json"), '{"source_type":"git"}\n');

		const result = await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		const pluginPath = result.installed[0].path;
		await rm(pluginPath, { recursive: true, force: true });

		const agentPath = join(codexHome, "agents", "explorer.toml");
		assert.equal((await lstat(agentPath)).isFile(), true);
		assert.equal(await readFile(agentPath, "utf8"), 'name = "explorer"\n');
		assert.equal(await readFile(join(snapshotRoot, ".git", "config"), "utf8"), "[remote \"origin\"]\n");
		assert.equal(await readFile(join(snapshotRoot, ".codex-marketplace-install.json"), "utf8"), '{"source_type":"git"}\n');
	},
);

test("#given local sisyphuslabs install #when temporary marketplace snapshot is removed #then agent files still resolve from Codex home", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");
	const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "sisyphuslabs",
		plugins: [{ name: "omo", source: "./plugins/omo" }],
	});
	await writePluginAt(pluginRoot, "omo", "0.1.0");
	await mkdir(agentsRoot, { recursive: true });
	await writeFile(join(agentsRoot, "explorer.toml"), 'name = "explorer"\n');
	await writeFile(join(agentsRoot, "plan.toml"), 'name = "plan"\n');

	await installMarketplaceLocally({
		repoRoot,
		codexHome,
		platform: "linux",
		runCommand: async () => {},
		log: () => {},
	});
	await rm(join(codexHome, ".tmp", "marketplaces", "sisyphuslabs"), { recursive: true, force: true });
	await rm(join(codexHome, "plugins", "cache", "sisyphuslabs"), { recursive: true, force: true });

	assert.equal(await readFile(join(codexHome, "agents", "explorer.toml"), "utf8"), 'name = "explorer"\n');
	assert.equal(await readFile(join(codexHome, "agents", "plan.toml"), "utf8"), 'name = "plan"\n');
});

test(
	"#given bundled ultrawork plan #when installing locally #then fresh installs write bundled default xhigh",
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		await writeFile(
			join(agentsRoot, "plan.toml"),
			'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
		);

		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		assert.equal(
			await readFile(join(codexHome, "agents", "plan.toml"), "utf8"),
			'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
		);
	},
);

test(
	"#given bundled ultrawork plan #when reinstalling without edits #then bundled xhigh stays intact",
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		await writeFile(
			join(agentsRoot, "plan.toml"),
			'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
		);

		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});
		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		assert.equal(
			await readFile(join(codexHome, "agents", "plan.toml"), "utf8"),
			'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
		);
	},
);

test(
	"#given user edited installed ultrawork plan #when reinstalling after snapshot refresh #then high survives",
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		await writeFile(
			join(agentsRoot, "plan.toml"),
			'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
		);

		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});
		await writeFile(join(codexHome, "agents", "plan.toml"), 'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high"\n');
		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		const installedPlan = await readFile(join(codexHome, "agents", "plan.toml"), "utf8");
		assert.ok(installedPlan.includes('model_reasoning_effort = "high"'));
		assert.equal(installedPlan.includes('model_reasoning_effort = "xhigh"'), false);
		const installedStat = await lstat(join(codexHome, "agents", "plan.toml"));
		assert.equal(installedStat.isFile(), true);
		assert.equal(installedStat.isSymbolicLink(), false);
	},
);

test(
	"#given user removed installed ultrawork service tier #when reinstalling after snapshot refresh #then removal survives",
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		await writeFile(
			join(agentsRoot, "explorer.toml"),
			'name = "explorer"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "low"\nservice_tier = "fast"\n',
		);

		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});
		await writeFile(join(codexHome, "agents", "explorer.toml"), 'name = "explorer"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "low"\n');
		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		const installedExplorer = await readFile(join(codexHome, "agents", "explorer.toml"), "utf8");
		assert.equal(installedExplorer.includes("service_tier"), false);
	},
);

test(
	"#given user edited installed ultrawork plan #when reinstalling after snapshot refresh #then bundled snapshot target retains xhigh",
	async () => {
		const repoRoot = await makeTempDir();
		const codexHome = await makeTempDir();
		const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
		const pluginRoot = join(codexPackageRoot, "plugin");
		const agentsRoot = join(pluginRoot, "components", "ultrawork", "agents");

		await writeJson(join(codexPackageRoot, "marketplace.json"), {
			name: "sisyphuslabs",
			plugins: [{ name: "omo", source: "./plugins/omo" }],
		});
		await writePluginAt(pluginRoot, "omo", "0.1.0");
		await mkdir(agentsRoot, { recursive: true });
		await writeFile(
			join(agentsRoot, "plan.toml"),
			'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
		);

		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});
		await writeFile(join(codexHome, "agents", "plan.toml"), 'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high"\n');
		await installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "linux",
			runCommand: async () => {},
			log: () => {},
		});

		const snapshotPlan = await readFile(
			join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo", "components", "ultrawork", "agents", "plan.toml"),
			"utf8",
		);
		assert.ok(snapshotPlan.includes('model_reasoning_effort = "xhigh"'));
		assert.equal(snapshotPlan.includes('model_reasoning_effort = "high"'), false);
	},
);
