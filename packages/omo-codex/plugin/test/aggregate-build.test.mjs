import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readJson, root } from "./aggregate-plugin-fixture.mjs";

test("#given aggregate plugin build script #when inspected #then generated assets run before workspace builds", async () => {
	// given
	const packageText = await readFile(join(root, "package.json"), "utf8");
	const packageJson = await readJson("package.json");

	// when
	const buildScript = packageJson.scripts.build;
	const testScript = packageJson.scripts.test;

	// then
	assert.equal(
		buildScript,
		"node scripts/sync-version.mjs && node scripts/sync-hook-status-messages.mjs && node scripts/build-bundled-mcp-runtimes.mjs && node scripts/materialize-shared-upstreams.mjs --strict && node scripts/sync-skills.mjs && node scripts/build-components.mjs",
	);
	assert.match(buildScript, /^node scripts\/sync-version\.mjs &&/);
	assert.match(buildScript, /materialize-shared-upstreams\.mjs --strict && node scripts\/sync-skills\.mjs/);
	assert.equal(testScript, "node --test test/*.test.mjs");
	assert(packageJson.workspaces.includes("components/ultrawork"));
	assert.doesNotMatch(packageText, /\bpython3?\b|ultrawork-detector\.py/);
});

test("#given omo-codex package build script #when inspected #then delegates to the aggregate plugin package", async () => {
	// given
	const packageJson = JSON.parse(await readFile(join(root, "..", "package.json"), "utf8"));

	// when
	const buildPluginScript = packageJson.scripts["build:plugin"];

	// then
	assert.equal(buildPluginScript, "bun run --cwd plugin build");
});

test("#given a component-owned runtime manifest #when aggregate component build script is inspected #then it preserves bundled bytes", async () => {
	const buildScript = await readFile(join(root, "scripts", "build-components.mjs"), "utf8");

	assert.match(buildScript, /hasComponentOwnedBundle/u);
	assert.match(buildScript, /"dist", "\.omo-runtime-manifest\.json"/u);
	assert.match(buildScript, /if \(await hasComponentOwnedBundle\(task\.componentPath\)\) return/u);
});
