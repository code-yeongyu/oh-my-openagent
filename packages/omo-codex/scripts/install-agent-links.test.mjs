import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

const legacyCodexPluginMarketplace = ["code", "yeongyu", "codex", "plugins"].join("-");

test(
	"#given bundled agent roles and stale legacy links #when installing locally #then relinks Codex agents to marketplace snapshot",
	{ skip: process.platform === "win32" ? "Windows copies agent files instead of symlinking them" : false },
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
			assert.equal((await lstat(agentPath)).isSymbolicLink(), true);
			assert.equal(await readlink(agentPath), join(snapshotPluginPath, "components", "ultrawork", "agents", `${agentName}.toml`));
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
	"#given local sisyphuslabs install #when plugin cache is pruned #then agent links still resolve through marketplace snapshot",
	{ skip: process.platform === "win32" ? "Windows copies agent files instead of symlinking them" : false },
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
		assert.equal(
			await readlink(agentPath),
			join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo", "components", "ultrawork", "agents", "explorer.toml"),
		);
		assert.equal(await readFile(agentPath, "utf8"), 'name = "explorer"\n');
		assert.equal(await readFile(join(snapshotRoot, ".git", "config"), "utf8"), "[remote \"origin\"]\n");
		assert.equal(await readFile(join(snapshotRoot, ".codex-marketplace-install.json"), "utf8"), '{"source_type":"git"}\n');
	},
);
