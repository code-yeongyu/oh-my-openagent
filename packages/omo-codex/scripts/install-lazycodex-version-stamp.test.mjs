import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import { makeTempDir, writeJson, writePluginAt } from "./install-test-fixtures.mjs";

test("#given sisyphuslabs lazycodex install #when installing locally #then stamps the distribution version", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const binDir = await makeTempDir();
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const pluginRoot = join(codexPackageRoot, "plugin");

	await writeJson(join(repoRoot, "package.json"), { name: "lazycodex-ai", version: "4.7.6" });
	await writeJson(join(codexPackageRoot, "marketplace.json"), {
		name: "sisyphuslabs",
		plugins: [{ name: "omo", source: "./plugin" }],
	});
	await writePluginAt(pluginRoot, "omo", "0.1.0");
	await writeJson(join(pluginRoot, "hooks", "hooks.json"), {
		hooks: {
			PostToolUse: [
				{
					hooks: [
						{
							type: "command",
							command: 'node "${PLUGIN_ROOT}/components/comment-checker/dist/cli.js" hook post-tool-use',
							statusMessage: "LazyCodex(0.1.0): Checking Comments",
						},
					],
				},
			],
		},
	});

	const result = await installMarketplaceLocally({
		repoRoot,
		codexHome,
		binDir,
		platform: "linux",
		runCommand: async () => {},
		log: () => {},
	});

	const cacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "4.7.6");
	assert.equal(result.installed[0].version, "4.7.6");
	assert.equal(result.installed[0].path, cacheRoot);
	const manifest = JSON.parse(await readFile(join(cacheRoot, ".codex-plugin", "plugin.json"), "utf8"));
	const packageJson = JSON.parse(await readFile(join(cacheRoot, "package.json"), "utf8"));
	const hooks = JSON.parse(await readFile(join(cacheRoot, "hooks", "hooks.json"), "utf8"));
	const snapshot = JSON.parse(await readFile(join(cacheRoot, "lazycodex-install.json"), "utf8"));
	assert.equal(manifest.version, "4.7.6");
	assert.equal(packageJson.version, "4.7.6");
	assert.equal(hooks.hooks.PostToolUse[0].hooks[0].statusMessage, "LazyCodex(4.7.6): Checking Comments");
	assert.deepEqual(snapshot, {
		packageName: "lazycodex-ai",
		version: "4.7.6",
	});
});
