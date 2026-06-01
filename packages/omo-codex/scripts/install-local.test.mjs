import assert from "node:assert/strict";
import { mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installMarketplaceLocally, resolveCodexInstallerBinDir } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const legacyCodexPluginMarketplace = ["code", "yeongyu", "codex", "plugins"].join("-");

test("#given default CODEX_HOME #when resolving local installer bin dir without override #then preserves user local bin precedence", () => {
	const homeDir = join(tmpdir(), "omo-codex-home-default");
	const codexHome = join(homeDir, ".codex");

	assert.equal(resolveCodexInstallerBinDir({ codexHome, env: {}, homeDir }), join(homeDir, ".local", "bin"));
});

test("#given custom CODEX_HOME #when resolving local installer bin dir without override #then keeps generated omo inside that Codex home", () => {
	const homeDir = join(tmpdir(), "omo-codex-home-custom");
	const codexHome = join(tmpdir(), "omo-codex-install-custom");

	assert.equal(resolveCodexInstallerBinDir({ codexHome, env: {}, homeDir }), join(codexHome, "bin"));
});

test("#given custom CODEX_HOME and PATH without omo #when installing locally without bin override #then bootstraps via local CLI when omo is absent", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const homeDir = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "sisyphuslabs",
		plugins: [{ name: "omo", source: "./plugins/omo" }],
	});
	await writePluginAt(pluginRoot, "omo", "0.1.0");

	const result = await installMarketplaceLocally({
		repoRoot,
		codexHome,
		env: { PATH: "/usr/bin:/bin" },
		homeDir,
		platform: "linux",
		runCommand: async () => {},
		log: () => {},
	});

	assert.equal(result.installed.length, 1);
	assert.equal(await readlink(join(codexHome, "bin", "omo")), join(result.installed[0].path, "dist", "cli.js"));
});

test("#given explicit CODEX_LOCAL_BIN_DIR #when resolving local installer bin dir #then preserves installed omo precedence", () => {
	const homeDir = join(tmpdir(), "omo-codex-home-explicit");
	const codexHome = join(tmpdir(), "omo-codex-install-explicit");
	const explicitBinDir = join(tmpdir(), "omo-codex-explicit-bin");

	assert.equal(
		resolveCodexInstallerBinDir({
			codexHome,
			env: { CODEX_LOCAL_BIN_DIR: explicitBinDir },
			homeDir,
		}),
		explicitBinDir,
	);
});

test("#given CODEX_LOCAL_BIN_DIR with surrounding whitespace #when resolving local installer bin dir #then trims the env value before use", () => {
	const homeDir = join(tmpdir(), "omo-codex-home-trim");
	const codexHome = join(tmpdir(), "omo-codex-install-trim");
	const explicitBinDir = join(tmpdir(), "omo-codex-trim-bin");

	assert.equal(
		resolveCodexInstallerBinDir({
			codexHome,
			env: { CODEX_LOCAL_BIN_DIR: `  ${explicitBinDir}  ` },
			homeDir,
		}),
		explicitBinDir,
	);
});

test("#given omo plugin source #when inspecting identity #then uses sisyphuslabs omo metadata", async () => {
	const pluginRoot = join(scriptDir, "..", "plugin");

	const manifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
	const packageJson = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));

	assert.equal(packageJson.name, "@sisyphuslabs/omo-codex-plugin");
	assert.equal(manifest.homepage, "https://github.com/sisyphuslabs/omo");
	assert.equal(manifest.repository, "https://github.com/sisyphuslabs/omo");
	assert.equal(manifest.interface.websiteURL, "https://github.com/sisyphuslabs/omo");
	assert.equal(manifest.interface.privacyPolicyURL, "https://github.com/sisyphuslabs/omo#privacy");
	assert.equal(manifest.interface.termsOfServiceURL, "https://github.com/sisyphuslabs/omo#license");
});

test("#given local marketplace #when installing #then copies versioned plugins and enables config", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [
			{
				name: "alpha",
				source: "./plugins/alpha",
			},
		],
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
		bin: {
			alpha: "./dist/cli.js",
		},
		scripts: {
			build: "node -e \"require('fs').writeFileSync('dist/cli.js', 'console.log(1)')\"",
		},
		dependencies: {
			"@example/shared-lsp": "file:../shared-lsp",
		},
	});
	await writeJson(join(pluginRoot, ".mcp.json"), {
		mcpServers: {
			alpha: {
				command: "node",
				args: ["./dist/cli.js", "mcp"],
				cwd: ".",
			},
			shared: {
				command: "node",
				args: ["../shared-lsp/dist/cli.js", "mcp"],
				cwd: ".",
			},
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

	assert.deepEqual(
		result.installed.map((plugin) => `${plugin.name}@${plugin.version}`),
		["alpha@1.2.3"],
	);
	const alphaCacheRoot = join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", "1.2.3");
	assert.equal((await stat(join(alphaCacheRoot, "dist", "cli.js"))).isFile(), true);
	assert.equal((await stat(join(alphaCacheRoot, ".mcp.json"))).isFile(), true);
	assert.equal(await readlink(join(binDir, "alpha")), join(alphaCacheRoot, "dist", "cli.js"));
	const alphaMcp = JSON.parse(await readFile(join(alphaCacheRoot, ".mcp.json"), "utf8"));
	const sharedMcpCli = join(alphaCacheRoot, "mcp", "shared", "dist", "cli.js");
	assert.deepEqual(alphaMcp.mcpServers.alpha.args, [join(alphaCacheRoot, "dist", "cli.js"), "mcp"]);
	assert.deepEqual(alphaMcp.mcpServers.shared.args, [sharedMcpCli, "mcp"]);
	assert.equal((await stat(sharedMcpCli)).isFile(), true);
	assert.equal(
		Object.hasOwn(alphaMcp.mcpServers.alpha, "cwd"),
		false,
		"`cwd: \".\"` must be stripped so the spawned MCP server inherits the caller's workspace cwd",
	);
	assert.equal(Object.hasOwn(alphaMcp.mcpServers.shared, "cwd"), false);
	assert.equal(alphaMcp.mcpServers.alpha.command, "node");
	const alphaPackageJson = JSON.parse(await readFile(join(alphaCacheRoot, "package.json"), "utf8"));
	assert.equal(alphaPackageJson.dependencies["@example/shared-lsp"], `file:${join(codexPackageRoot, "shared-lsp")}`);
	await assert.rejects(
		stat(join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", "1.2.3", "node_modules")),
		/code: 'ENOENT'|ENOENT/,
	);
	await assert.rejects(
		stat(join(codexHome, "plugins", "cache", "debug-marketplace", "stale")),
		/code: 'ENOENT'|ENOENT/,
	);
	assert.deepEqual(
		commands.map(([command, args, cwd]) => [command, args.join(" "), cwd]),
		[
			["npm", "install", pluginRoot],
			["npm", "run build", pluginRoot],
			["npm", "install --omit=dev", join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", "1.2.3")],
		],
	);

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[features\]\n(?:plugin_hooks = true\n)?plugins = true/);
	assert.match(config, /\[marketplaces\.debug-marketplace\]/);
	assert.match(config, /source_type = "local"/);
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
		mcpServers: {
			lsp: {
				command: "node",
				args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await mkdir(join(codexHome, "plugins", "cache", legacyCodexPluginMarketplace, "omo", "0.1.0"), {
		recursive: true,
	});
	await writeJson(join(codexHome, "plugins", "cache", legacyCodexPluginMarketplace, "omo", "0.1.0", ".mcp.json"), {
		mcpServers: {
			lsp: {
				command: "node",
				args: ["old/components/lsp/packages/lsp-tools-mcp/dist/cli.js", "mcp"],
			},
		},
	});
	const legacyPluginKey = `omo@${legacyCodexPluginMarketplace}`;
	await writeFile(
		join(codexHome, "config.toml"),
		[
			`[marketplaces.${legacyCodexPluginMarketplace}]`,
			'last_updated = "2026-05-01T00:00:00Z"',
			'source_type = "git"',
			'source = "https://github.com/code-yeongyu/codex-plugins.git"',
			"",
			`[plugins.${JSON.stringify(legacyPluginKey)}]`,
			"enabled = true",
			"",
			`[plugins.${JSON.stringify(legacyPluginKey)}.mcp_servers.lsp]`,
			'enabled = true',
			"",
			`[hooks.state.${JSON.stringify(`${legacyPluginKey}:hooks/hooks.json:post_tool_use:0:0`)}]`,
			'trusted_hash = "sha256:old"',
			"",
		].join("\n"),
	);

	await installMarketplaceLocally({
		repoRoot,
		codexHome,
		runCommand: async () => {},
		log: () => {},
	});

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[marketplaces\.sisyphuslabs\]/);
	assert.match(config, /source_type = "local"/);
	assert.match(config, new RegExp(`source = ${JSON.stringify(join(codexHome, "plugins", "cache", "sisyphuslabs")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	assert.doesNotMatch(config, /ref = "main"/);
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
	assert.doesNotMatch(config, /\[marketplaces\.lazycodex\]/);
	assert.doesNotMatch(config, new RegExp(legacyCodexPluginMarketplace));
	assert.doesNotMatch(config, /lazycodex\.git/);
	const marketplace = JSON.parse(
		await readFile(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"), "utf8"),
	);
	assert.deepEqual(marketplace.plugins, [{ name: "omo", source: { source: "local", path: "./omo/0.1.0" } }]);
	const cachedMcp = JSON.parse(
		await readFile(join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", ".mcp.json"), "utf8"),
	);
	assert.equal(
		cachedMcp.mcpServers.lsp.args[0],
		join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "mcp", "lsp", "dist", "cli.js"),
	);
	assert.doesNotMatch(cachedMcp.mcpServers.lsp.args[0], /components\/lsp\/packages/);
	assert.equal((await stat(cachedMcp.mcpServers.lsp.args[0])).isFile(), true);
	const snapshotPluginRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo");
	const snapshotMcp = JSON.parse(await readFile(join(snapshotPluginRoot, ".mcp.json"), "utf8"));
	assert.equal(
		snapshotMcp.mcpServers.lsp.args[0],
		join(snapshotPluginRoot, "mcp", "lsp", "dist", "cli.js"),
	);
	assert.doesNotMatch(snapshotMcp.mcpServers.lsp.args[0], /\.\.\/\.\.\/lsp-tools-mcp/);
	assert.doesNotMatch(snapshotMcp.mcpServers.lsp.args[0], /components\/lsp\/packages/);
	assert.equal((await stat(snapshotMcp.mcpServers.lsp.args[0])).isFile(), true);
	await assert.rejects(
		stat(join(codexHome, "plugins", "cache", legacyCodexPluginMarketplace, "omo")),
		/code: 'ENOENT'|ENOENT/,
	);
});

test("#given plugin hooks #when installing #then records trusted hook hashes", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [{ name: "alpha", source: "./plugins/alpha" }],
	});
	const pluginRoot = join(codexPackageRoot, "plugin");
	await writePluginAt(pluginRoot, "alpha", "1.2.3");
	await writeJson(join(pluginRoot, "hooks", "hooks.json"), {
		hooks: {
			UserPromptSubmit: [
				{
					hooks: [
						{
							type: "command",
							command: "node \"${PLUGIN_ROOT}/dist/cli.js\" hook user-prompt-submit",
							timeout: 10,
							statusMessage: "checking alpha",
						},
					],
				},
			],
		},
	});

	await installMarketplaceLocally({
		repoRoot,
		codexHome,
		runCommand: async () => {},
		log: () => {},
	});

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[hooks\.state\."alpha@debug-marketplace:hooks\/hooks\.json:user_prompt_submit:0:0"\]/);
	assert.match(config, /trusted_hash = "sha256:[a-f0-9]{64}"/);
});

test("#given bad plugin source path #when installing #then rejects traversal", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");

	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [
			{
				name: "escape",
				source: "../escape",
			},
		],
	});

	await assert.rejects(
		installMarketplaceLocally({ repoRoot, codexHome, log: () => {} }),
		/local plugin source path must start with \.\//,
	);
});
