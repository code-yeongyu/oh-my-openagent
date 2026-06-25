import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const entrypointPath = join(scriptsDir, "install-local.mjs");

test("#given the stable installer entrypoint #when inspecting imports #then it delegates to generated output", async () => {
	// given
	const entrypoint = await readFile(entrypointPath, "utf8");

	// when
	const importsForkModules = entrypoint.includes("./install/");
	const importsGeneratedBundle = entrypoint.includes("./install-dist/install-local.mjs");

	// then
	assert.equal(importsForkModules, false);
	assert.equal(importsGeneratedBundle, true);
});

test("#given generated installer output #when importing install-local #then public installer API comes from the bundle", async () => {
	// given
	const module = await import("./install-local.mjs");

	// when
	const exportedNames = ["installMarketplaceLocally", "resolveCodexInstallerBinDir", "resolveDefaultRepoRoot"];

	// then
	for (const name of exportedNames) {
		assert.equal(typeof module[name], "function", `${name} must be exported`);
	}
});

test("#given generated installer output #when importing direct bundle #then compatibility helper APIs are exported", async () => {
	// given
	const module = await import(`./install-dist/install-local.mjs?helpers=${Date.now()}`);

	// when
	const exportedNames = [
		"installCachedPlugin",
		"linkCachedPluginBins",
		"linkRootRuntimeBin",
		"readCodexModelCatalog",
		"repairNearestProjectLocalCodexArtifacts",
		"stampGitBashMcpEnv",
		"updateCodexConfig",
	];

	// then
	for (const name of exportedNames) {
		assert.equal(typeof module[name], "function", `${name} must be exported`);
	}
});
