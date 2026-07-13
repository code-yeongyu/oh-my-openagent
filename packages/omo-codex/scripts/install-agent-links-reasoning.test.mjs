import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";
import {
	makeTempDir,
	writeJson,
	writePluginAt,
} from "./install-test-fixtures.mjs";

test("#given an explicit custom model for an unlisted bundled role #when reinstalling #then generated installer preserves it", async () => {
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
		join(agentsRoot, "metis.toml"),
		agentToml("metis", "gpt-5.6-sol", "high"),
	);
	await mkdir(join(codexHome, "agents"), { recursive: true });
	await writeFile(
		join(codexHome, "agents", "metis.toml"),
		agentToml("metis", "custom-model", "medium"),
	);

	await installMarketplaceLocally({
		repoRoot,
		codexHome,
		platform: "linux",
		runCommand: async () => {},
		log: () => {},
	});

	const installed = await readFile(
		join(codexHome, "agents", "metis.toml"),
		"utf8",
	);
	assert.match(installed, /^model = "custom-model"$/m);
	assert.match(installed, /^model_reasoning_effort = "medium"$/m);
});

function agentToml(name, model, effort) {
	return `name = "${name}"\nmodel = "${model}"\nmodel_reasoning_effort = "${effort}"\n`;
}
