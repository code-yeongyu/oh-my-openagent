import assert from "node:assert/strict";
import { mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

const legacyCodexPluginMarketplace = ["code", "yeongyu", "codex", "plugins"].join("-");

test("#given local marketplace #when installing #then copies versioned plugins and enables config", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [{ name: "alpha", source: "./plugins/alpha" }],
	});
	await writePluginAt(pluginRoot, "alpha", "1.2.3");
	await mkdir(join(codexPackageRoot, "shared-lsp", "dist"), { recursive: true });
	await writeJson(join(codexPackageRoot, "shared-lsp", "package.json"), {
		name: "@example/shared-lsp",
		version: "0.0.0",
		type: "module",
		bin: { "shared-lsp": "./dist/cli.js" },
	});
	await writeFile(join(codexPackageRoot, "shared-lsp", "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/alpha",
		version: "1.2.3",
		bin: { alpha: "./dist/cli.js" },
		scripts: { build: "node -e \"require('fs').writeFileSync('dist/cli.js', 'console.log(1)')\"" },
		dependencies: { "@example/shared-lsp": "file:../shared-lsp" },
	});
	await writeJson(join(pluginRoot, ".mcp.json"), {
		mcpServers: {
			alpha: { command: "node", args: ["./dist/cli.js", "mcp"], cwd: "." },
			shared: { command: "node", args: ["../shared-lsp/dist/cli.js", "mcp"], cwd: "." },
		},
	});
	await mkdir(join(pluginRoot, "node_modules"), { recursive: true });
	await writeFile(join(pluginRoot, "node_modules", "skip.txt"), "skip");
	await mkdir(join(codexHome, "plugins", "cache", "debug-marketplace", "stale", "0.1.0"), { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		[
			'[plugins."stale@debug-marketplace"]',
			"enabled = true",
			"",
			'[hooks.state."stale@debug-marketplace:hooks/hooks.json:user_prompt_submit:0:0"]',
			'trusted_hash = "sha256:old"',
			"",
		].join("\n"),
	);

	const commands = [];
	const result = await installMarketplaceLocally({
		repoRoot,
		codexHome,
		binDir,
		platform: "linux",
		runCommand: async (command, args, options) => {
			commands.push([command, args, options.cwd]);
			if (command === "npm" && args.join(" ") === "run build") {
				await mkdir(join(options.cwd, "dist"), { recursive: true });
				await writeFile(join(options.cwd, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log(1)\n");
			}
		},
		log: () => {},
	});

	assert.deepEqual(result.installed.map((plugin) => `${plugin.name}@${plugin.version}`), ["alpha@1.2.3"]);
	const alphaCacheRoot = join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", "1.2.3");
	assert.equal((await stat(join(alphaCacheRoot, "dist", "cli.js"))).isFile(), true);
	assert.equal(await readlink(join(binDir, "alpha")), join(alphaCacheRoot, "dist", "cli.js"));
	const alphaMcp = JSON.parse(await readFile(join(alphaCacheRoot, ".mcp.json"), "utf8"));
	const sharedMcpCli = join(codexPackageRoot, "shared-lsp", "dist", "cli.js");
	assert.deepEqual(alphaMcp.mcpServers.alpha.args, [join(alphaCacheRoot, "dist", "cli.js"), "mcp"]);
	assert.deepEqual(alphaMcp.mcpServers.shared.args, [sharedMcpCli, "mcp"]);
	assert.equal((await stat(sharedMcpCli)).isFile(), true);
	assert.equal(Object.hasOwn(alphaMcp.mcpServers.alpha, "cwd"), false);
	assert.equal(Object.hasOwn(alphaMcp.mcpServers.shared, "cwd"), false);
	assert.equal(alphaMcp.mcpServers.alpha.command, "node");
	const alphaPackageJson = JSON.parse(await readFile(join(alphaCacheRoot, "package.json"), "utf8"));
	assert.equal(alphaPackageJson.dependencies["@example/shared-lsp"], `file:${join(codexPackageRoot, "shared-lsp")}`);
	await assert.rejects(stat(join(alphaCacheRoot, "node_modules")), /code: 'ENOENT'|ENOENT/);
	await assert.rejects(stat(join(codexHome, "plugins", "cache", "debug-marketplace", "stale")), /code: 'ENOENT'|ENOENT/);
	const commandLog = commands.map(([command, args, cwd]) => [command, args.join(" "), cwd]);
	assert.deepEqual(commandLog.slice(0, 2), [
		["npm", "install", pluginRoot],
		["npm", "run build", pluginRoot],
	]);
	assert.equal(commandLog[2][0], "npm");
	assert.equal(commandLog[2][1], "ci --omit=dev");
	assert.equal(commandLog[2][2].startsWith(join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", ".tmp-1.2.3-")), true);

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[marketplaces\.debug-marketplace\]/);
	assert.match(config, /\[plugins\."alpha@debug-marketplace"\]\nenabled = true/);
	assert.match(config, /\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/);
	assert.match(config, /\[agents\.librarian\]\nconfig_file = "\.\/agents\/librarian\.toml"/);
	assert.match(config, /\[agents\.plan\]\nconfig_file = "\.\/agents\/plan\.toml"/);
	assert.doesNotMatch(config, /stale@debug-marketplace/);
});

test("#given sisyphuslabs marketplace #when installing #then registers the local built marketplace cache", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "sisyphuslabs",
		plugins: [{ name: "omo", source: "./plugins/omo" }],
	});
	await writePluginAt(join(codexPackageRoot, "plugin"), "omo", "0.1.0");
	await mkdir(join(repoRoot, "packages", "lsp-tools-mcp", "dist"), { recursive: true });
	await writeJson(join(repoRoot, "packages", "lsp-tools-mcp", "package.json"), {
		name: "@example/lsp-tools-mcp",
		version: "0.1.0",
		type: "module",
		bin: { "omo-lsp": "./dist/cli.js" },
	});
	await writeFile(join(repoRoot, "packages", "lsp-tools-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeJson(join(codexPackageRoot, "plugin", ".mcp.json"), {
		mcpServers: { lsp: { command: "node", args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." } },
	});
	await mkdir(join(codexHome, "plugins", "cache", legacyCodexPluginMarketplace, "omo", "0.1.0"), { recursive: true });
	const legacyPluginKey = `omo@${legacyCodexPluginMarketplace}`;
	await writeFile(
		join(codexHome, "config.toml"),
		[
			`[marketplaces.${legacyCodexPluginMarketplace}]`,
			'source_type = "git"',
			"",
			`[plugins.${JSON.stringify(legacyPluginKey)}]`,
			"enabled = true",
			"",
		].join("\n"),
	);

	await installMarketplaceLocally({ repoRoot, codexHome, runCommand: async () => {}, log: () => {} });

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[marketplaces\.sisyphuslabs\]/);
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
	assert.doesNotMatch(config, new RegExp(legacyCodexPluginMarketplace));
	const marketplace = JSON.parse(
		await readFile(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"), "utf8"),
	);
	assert.deepEqual(marketplace.plugins, [{ name: "omo", source: { source: "local", path: "./omo/0.1.0" } }]);
	const cachedMcp = JSON.parse(await readFile(join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", ".mcp.json"), "utf8"));
	assert.equal(cachedMcp.mcpServers.lsp.args[0], join(repoRoot, "packages", "lsp-tools-mcp", "dist", "cli.js"));
	assert.equal((await stat(cachedMcp.mcpServers.lsp.args[0])).isFile(), true);
	const snapshotPluginRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo");
	const snapshotMcp = JSON.parse(await readFile(join(snapshotPluginRoot, ".mcp.json"), "utf8"));
	assert.equal(snapshotMcp.mcpServers.lsp.args[0], join(repoRoot, "packages", "lsp-tools-mcp", "dist", "cli.js"));
	assert.equal((await stat(snapshotMcp.mcpServers.lsp.args[0])).isFile(), true);
	await assert.rejects(stat(join(codexHome, "plugins", "cache", legacyCodexPluginMarketplace, "omo")), /code: 'ENOENT'|ENOENT/);
});
