import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installMarketplaceLocally, resolveCodexInstallerBinDir } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function escapePosixDoubleQuoted(value) {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`");
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosixPath(value) {
	return value.replaceAll("\\", "/");
}

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
	await mkdir(join(repoRoot, "dist", "cli"), { recursive: true });
	await writeFile(join(repoRoot, "dist", "cli", "index.js"), "#!/usr/bin/env bun\n");

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
	const wrapper = await readFile(join(codexHome, "bin", "omo"), "utf8");
	assert.match(wrapper, /OMO_GENERATED_RUNTIME_WRAPPER/);
	assert.match(
		wrapper,
		new RegExp(escapeRegExp(escapePosixDoubleQuoted(toPosixPath(join(repoRoot, "dist", "cli", "index.js"))))),
	);
	assert.match(wrapper, /CODEX_HOME/);
	assert.match(wrapper, /omo-ulw-loop/);
});

test("#given repoRoot without root CLI dist #when installing locally #then warns about the skipped omo runtime wrapper", async () => {
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

	const logs = [];
	await installMarketplaceLocally({
		repoRoot,
		codexHome,
		env: {},
		homeDir,
		platform: "linux",
		runCommand: async () => {},
		log: (line) => logs.push(String(line)),
	});

	const cliPath = join(repoRoot, "dist", "cli", "index.js");
	assert.ok(
		logs.some((line) => line.includes("omo runtime wrapper") && line.includes(cliPath)),
		`expected a warning naming the missing ${cliPath}; got:\n${logs.join("\n")}`,
	);
	await assert.rejects(readFile(join(codexHome, "bin", "omo"), "utf8"));
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
	await writeFile(join(pluginRoot, "dist", "cli.js"), "console.log('plugin cli')\n");
	await writeFile(join(pluginRoot, "dist", "cli.ps1"), "Write-Output 'plugin cli'\n");
	await writeJson(join(pluginRoot, "hooks", "hooks.json"), {
		hooks: {
			UserPromptSubmit: [
				{
					hooks: [
						{
							type: "command",
							command: "node \"${PLUGIN_ROOT}/dist/cli.js\" hook user-prompt-submit",
							commandWindows: 'powershell -File "${PLUGIN_ROOT}\\dist\\cli.ps1" hook user-prompt-submit',
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
		platform: "win32",
		gitBashResolver: () => ({ found: true, path: "C:\\Program Files\\Git\\bin\\bash.exe", source: "program-files" }),
		runCommand: async () => {},
		log: () => {},
	});

	const config = await readFile(join(codexHome, "config.toml"), "utf8");
	assert.match(config, /\[hooks\.state\."alpha@debug-marketplace:hooks\/hooks\.json:user_prompt_submit:0:0"\]/);
	assert.match(config, /trusted_hash = "sha256:605b27c7b1f93c02aa2f8052fd9df870a221c3dc432795c48b223fe48afcebc0"/);
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
