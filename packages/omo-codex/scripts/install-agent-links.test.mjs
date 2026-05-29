import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

const legacyCodexPluginMarketplace = ["code", "yeongyu", "codex", "plugins"].join("-");

test(
	"#given bundled agent roles and stale legacy links #when installing locally #then relinks Codex agents to current cache",
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
		const pluginPath = result.installed[0].path;
		for (const agentName of ["explorer", "librarian", "plan"]) {
			const agentPath = join(codexHome, "agents", `${agentName}.toml`);
			assert.equal((await lstat(agentPath)).isSymbolicLink(), true);
			assert.equal(await readlink(agentPath), join(pluginPath, "components", "ultrawork", "agents", `${agentName}.toml`));
			assert.equal(await readFile(agentPath, "utf8"), `name = "${agentName}"\n`);
		}

		const installedAgents = JSON.parse(await readFile(join(pluginPath, ".installed-agents.json"), "utf8"));
		assert.deepEqual(installedAgents.agents.sort(), [
			join(codexHome, "agents", "explorer.toml"),
			join(codexHome, "agents", "librarian.toml"),
			join(codexHome, "agents", "plan.toml"),
		]);
	},
);
