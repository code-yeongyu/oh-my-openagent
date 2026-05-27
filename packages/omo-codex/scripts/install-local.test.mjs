import assert from "node:assert/strict";
import { mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { linkCachedPluginBins } from "./install/cache.mjs";
import { makeTempDir, writeJson, writePlugin } from "./install-test-fixtures.mjs";

test("#given local marketplace #when installing #then copies versioned plugins and enables config", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();

	await mkdir(join(repoRoot, ".agents", "plugins"), { recursive: true });
	await writeJson(join(repoRoot, ".agents", "plugins", "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [
			{
				name: "alpha",
				source: "./plugins/alpha",
			},
			{
				name: "beta",
				source: {
					source: "local",
					path: "./plugins/beta",
				},
			},
		],
	});
	await writePlugin(repoRoot, "alpha", "1.2.3");
	await writePlugin(repoRoot, "beta", "0.4.0");
	await mkdir(join(repoRoot, "plugins", "alpha", "node_modules"), { recursive: true });
	await writeFile(join(repoRoot, "plugins", "alpha", "node_modules", "skip.txt"), "skip");
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
		},
		log: () => {},
	});

	assert.deepEqual(
		result.installed.map((plugin) => `${plugin.name}@${plugin.version}`),
		["alpha@1.2.3", "beta@0.4.0"],
	);
	const alphaCacheRoot = join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", "1.2.3");
	assert.equal((await stat(join(alphaCacheRoot, ".mcp.json"))).isFile(), true);
	assert.equal(await readlink(join(binDir, "alpha")), join(alphaCacheRoot, "dist", "cli.js"));
	const alphaMcp = JSON.parse(await readFile(join(alphaCacheRoot, ".mcp.json"), "utf8"));
	assert.deepEqual(alphaMcp.mcpServers.alpha.args, [join(alphaCacheRoot, "dist", "cli.js"), "mcp"]);
	assert.equal(
		Object.hasOwn(alphaMcp.mcpServers.alpha, "cwd"),
		false,
		"`cwd: \".\"` must be stripped so the spawned MCP server inherits the caller's workspace cwd",
	);
	assert.equal(alphaMcp.mcpServers.alpha.command, "node");
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
			["npm", "install", join(repoRoot, "plugins", "alpha")],
			["npm", "run build", join(repoRoot, "plugins", "alpha")],
			["npm", "install --omit=dev", join(codexHome, "plugins", "cache", "debug-marketplace", "alpha", "1.2.3")],
			["npm", "install", join(repoRoot, "plugins", "beta")],
			["npm", "run build", join(repoRoot, "plugins", "beta")],
			["npm", "install --omit=dev", join(codexHome, "plugins", "cache", "debug-marketplace", "beta", "0.4.0")],
		],
	);

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[features\]\n(?:plugin_hooks = true\n)?plugins = true/);
	assert.match(config, /\[marketplaces\.debug-marketplace\]/);
	assert.match(config, /source_type = "local"/);
	assert.match(config, /\[plugins\."alpha@debug-marketplace"\]\nenabled = true/);
	assert.match(config, /\[plugins\."beta@debug-marketplace"\]\nenabled = true/);
	assert.doesNotMatch(config, /stale@debug-marketplace/);
});

test("#given sisyphuslabs marketplace #when installing #then registers lazycodex git source", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();

	await mkdir(join(repoRoot, ".agents", "plugins"), { recursive: true });
	await writeJson(join(repoRoot, ".agents", "plugins", "marketplace.json"), {
		name: "sisyphuslabs",
		plugins: [{ name: "omo", source: "./plugins/omo" }],
	});
	await writePlugin(repoRoot, "omo", "0.1.0");

	await installMarketplaceLocally({
		repoRoot,
		codexHome,
		runCommand: async () => {},
		log: () => {},
	});

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[marketplaces\.sisyphuslabs\]/);
	assert.match(config, /source_type = "git"/);
	assert.match(config, /source = "https:\/\/github\.com\/code-yeongyu\/lazycodex\.git"/);
	assert.match(config, /ref = "main"/);
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
	assert.doesNotMatch(config, /\[marketplaces\.lazycodex\]/);
	assert.doesNotMatch(config, /code-yeongyu-codex-plugins/);
	assert.doesNotMatch(config, /source_type = "local"/);
});

test("#given plugin hooks #when installing #then records trusted hook hashes", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();

	await mkdir(join(repoRoot, ".agents", "plugins"), { recursive: true });
	await writeJson(join(repoRoot, ".agents", "plugins", "marketplace.json"), {
		name: "debug-marketplace",
		plugins: [{ name: "alpha", source: "./plugins/alpha" }],
	});
	await writePlugin(repoRoot, "alpha", "1.2.3");
	await writeJson(join(repoRoot, "plugins", "alpha", "hooks", "hooks.json"), {
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

	await mkdir(join(repoRoot, ".agents", "plugins"), { recursive: true });
	await writeJson(join(repoRoot, ".agents", "plugins", "marketplace.json"), {
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

test("#given Windows platform #when linking cached plugin bins #then writes command shims", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");

	await mkdir(pluginRoot, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/alpha",
		bin: {
			alpha: "./dist/cli.js",
		},
	});
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");

	const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" });

	assert.deepEqual(linked, [{ name: "alpha", path: join(binDir, "alpha.cmd"), target: join(pluginRoot, "dist", "cli.js") }]);
	const shim = await readFile(join(binDir, "alpha.cmd"), "utf8");
	assert.match(shim, /@echo off/);
	assert.match(shim, new RegExp(`node "${join(pluginRoot, "dist", "cli.js").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" %\\*`));
});

test("#given existing custom Windows command shim #when linking bins #then rejects without overwriting", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");

	await mkdir(pluginRoot, { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/alpha",
		bin: {
			alpha: "./dist/cli.js",
		},
	});
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(join(binDir, "alpha.cmd"), "@echo off\r\necho custom\r\n");

	await assert.rejects(
		linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" }),
		/already exists and is not a generated command shim/,
	);
	assert.match(await readFile(join(binDir, "alpha.cmd"), "utf8"), /echo custom/);
});
