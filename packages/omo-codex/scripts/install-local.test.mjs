import assert from "node:assert/strict";
import { mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import { installMarketplaceLocally } from "./install-local.mjs";

async function makeTempDir() {
	return mkdtemp(join(tmpdir(), "codex-plugins-install-"));
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePlugin(root, name, version) {
	const pluginRoot = join(root, "plugins", name);
	await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await mkdir(join(pluginRoot, "hooks"), { recursive: true });
	await mkdir(join(pluginRoot, "skills", name), { recursive: true });
	await writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
		name,
		version,
		description: `${name} test plugin`,
		mcpServers: "./.mcp.json",
		hooks: "./hooks/hooks.json",
		skills: "./skills/",
	});
	await writeJson(join(pluginRoot, ".mcp.json"), {
		mcpServers: {
			[name]: {
				command: "node",
				args: ["./dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await writeJson(join(pluginRoot, "hooks", "hooks.json"), { hooks: {} });
	await writeFile(join(pluginRoot, "skills", name, "SKILL.md"), "---\nname: test\n---\n");
	await writeJson(join(pluginRoot, "package.json"), {
		name: `@example/${name}`,
		version,
		bin: {
			[name]: "./dist/cli.js",
		},
		scripts: {
			build: "node -e \"require('fs').writeFileSync('dist/cli.js', 'console.log(1)')\"",
		},
		dependencies: {},
	});
}

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
