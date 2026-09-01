import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

test("#given packaged lazycodex adapter #when installing locally #then uses bundled artifacts without source builds", async () => {
	// given
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");
	const lspRuntimeRoot = join(repoRoot, "packages", "lsp-tools-mcp");

	await writeJson(join(repoRoot, "package.json"), {
		name: "lazycodex-ai",
		version: "0.1.2",
	});
	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "sisyphuslabs",
		plugins: [{ name: "omo", source: "./plugins/omo" }],
	});
	await writePluginAt(pluginRoot, "omo", "0.1.0");
	await writeJson(join(pluginRoot, ".mcp.json"), {
		mcpServers: {
			lsp: {
				command: "node",
				args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('prebuilt')\n");
	await writeJson(join(lspRuntimeRoot, "dist", "cli.js"), { executable: true });

	const commands = [];

	// when
	const result = await installMarketplaceLocally({
		repoRoot,
		codexHome,
		binDir,
		platform: "linux",
		runCommand: async (command, args, options) => {
			commands.push([command, args.join(" "), options.cwd]);
		},
		log: () => {},
	});

	// then
	const pluginCacheRoot = result.installed[0].path;
	const cachedMcp = JSON.parse(await readFile(join(pluginCacheRoot, ".mcp.json"), "utf8"));
	const cachedLspCli = join(lspRuntimeRoot, "dist", "cli.js");

	assert.deepEqual(result.installed.map((plugin) => `${plugin.name}@${plugin.version}`), ["omo@0.1.2"]);
	assert.equal(pluginCacheRoot, join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.2"));
	assert.equal(commands.length, 2);
	const installCommand = commands.find((entry) => entry[0] === "npm");
	assert.notEqual(installCommand, undefined);
	const [command, args, cwd] = installCommand;
	assert.equal(command, "npm");
	assert.equal(args, "ci --omit=dev");
	assert.equal(cwd.startsWith(join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", ".tmp-0.1.2-")), true);
	const sotCommand = commands.find((entry) => entry[1].includes("migrate-omo-sot.mjs"));
	assert.notEqual(sotCommand, undefined);
	assert.equal(sotCommand[0], process.execPath);
	assert.equal(sotCommand[1].includes("--seed"), true);
	assert.equal(sotCommand[2], repoRoot);
	assert.deepEqual(cachedMcp.mcpServers.lsp.args, [cachedLspCli, "mcp"]);
	assert.equal((await stat(cachedLspCli)).isFile(), true);
});
