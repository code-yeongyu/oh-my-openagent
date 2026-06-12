import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { exists, readJson, root } from "./aggregate-plugin-fixture.mjs";

test("#given aggregate plugin manifest #when inspected #then it owns the omo namespace", async () => {
	// given
	const manifest = await readJson(".codex-plugin/plugin.json");

	// when
	const hookPath = manifest.hooks;
	const skillsPath = manifest.skills;
	const mcpPath = manifest.mcpServers;

	// then
	assert.equal(manifest.name, "omo");
	assert.equal(hookPath, "./hooks/hooks.json");
	assert.equal(skillsPath, "./skills/");
	assert.equal(mcpPath, "./.mcp.json");
});

test("#given aggregate plugin metadata #when inspected #then ulw-loop is the public loop name", async () => {
	// given
	const manifestText = await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8");
	const manifest = JSON.parse(manifestText);

	// when
	const longDescription = String(manifest.interface?.longDescription ?? "");

	// then
	assert.match(longDescription, /ulw-loop/);
});

test("#given component directories #when scanned #then only intentional resource roots declare plugin manifests", async () => {
	// given
	const components = await readdir(join(root, "components"), { withFileTypes: true });
	const expectedComponentManifests = new Map([["rules", { hooks: "./hooks/hooks.json" }]]);

	// when
	const componentNames = [];
	for (const entry of components) {
		if (!entry.isDirectory()) continue;
		if (!(await exists(join("components", entry.name, "package.json")))) continue;
		componentNames.push(entry.name);
	}
	componentNames.sort();

	// then
	assert.deepEqual(componentNames, [
		"bootstrap",
		"comment-checker",
		"git-bash",
		"lsp",
		"rules",
		"start-work-continuation",
		"telemetry",
		"ultrawork",
		"ulw-loop",
	]);
	for (const name of componentNames) {
		const expectedManifest = expectedComponentManifests.get(name);
		if (expectedManifest !== undefined) {
			assert.deepEqual(await readJson(join("components", name, ".codex-plugin", "plugin.json")), expectedManifest);
			continue;
		}

		await assert.rejects(
			readFile(join(root, "components", name, ".codex-plugin", "plugin.json"), "utf8"),
			/code: 'ENOENT'|ENOENT/,
		);
	}
});
