import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const entrypointPath = join(scriptsDir, "install-local.mjs");

test("#given the stable installer entrypoint #when inspecting imports #then it delegates to generated output", async () => {
	// given
	const entrypoint = await readFile(entrypointPath, "utf8");

	// when
	const importsForkModules = entrypoint.includes("./install/");
	const importsGeneratedBundle = entrypoint.includes(
		"./install-dist/install-local.mjs",
	);

	// then
	assert.equal(importsForkModules, false);
	assert.equal(importsGeneratedBundle, true);
});

test("#given generated installer output #when importing install-local #then public installer API comes from the bundle", async () => {
	// given
	const module = await import("./install-local.mjs");

	// when
	const exportedNames = [
		"installMarketplaceLocally",
		"resolveCodexInstallerBinDir",
		"resolveDefaultRepoRoot",
	];

	// then
	for (const name of exportedNames) {
		assert.equal(typeof module[name], "function", `${name} must be exported`);
	}
});

test("#given generated installer output #when importing direct bundle #then compatibility helper APIs are exported", async () => {
	// given
	const module = await import(
		`./install-dist/install-local.mjs?helpers=${Date.now()}`
	);

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

test("#given no root model #when generated bundle updates config #then it does not introduce agents max_threads", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-generated-no-root-model-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model_reasoning_effort = "high"',
			"",
			"[features]",
			"plugins = false",
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^\s*max_threads\s*=/m);
	assert.doesNotMatch(config, /max_concurrent_threads_per_session/);
});

test("#given explicit v1 model catalog with a historical managed V2 cap #when generated bundle updates config #then preserves disable and removes only the managed V2 cap", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-generated-catalog-v1-"));
	const configPath = join(root, "config.toml");
	const catalogPath = join(root, "custom-catalog.json");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			`model_catalog_json = ${JSON.stringify(catalogPath)}`,
			"",
			"[features]",
			"multi_agent_v2 = false",
			"",
			"# Work around openai/codex#26753: multi_agent_v2 is re-disabled on every Codex session start",
			"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 1000",
			"",
			"[agents]",
			"max_threads = 16",
			"",
		].join("\n"),
	);
	await writeFile(
		catalogPath,
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }],
		}),
	);
	await writeFile(
		join(root, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }],
		}),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	const v2Section = sectionText(config, "[features.multi_agent_v2]");
	assert.match(v2Section, /^enabled = false$/m);
	assert.doesNotMatch(v2Section, /max_concurrent_threads_per_session/);
	assert.match(config, /\[agents\][\s\S]*?max_threads = 16/);
});

test("#given explicit v2 model_catalog_json and stale models_cache v1 #when generated bundle updates config #then explicit catalog clears the disable and preserves user concurrency", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-generated-catalog-v2-"));
	const configPath = join(root, "config.toml");
	const catalogPath = join(root, "custom-catalog.json");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			`model_catalog_json = ${JSON.stringify(catalogPath)}`,
			"",
			"[features]",
			"multi_agent_v2 = false",
			"",
			"[agents]",
			"max_threads = 16",
			"",
		].join("\n"),
	);
	await writeFile(
		catalogPath,
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }],
		}),
	);
	await writeFile(
		join(root, "models_cache.json"),
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }],
		}),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	const v2Section = sectionText(config, "[features.multi_agent_v2]");
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.match(config, /^\s*max_threads\s*=\s*16$/m);
	assert.doesNotMatch(v2Section, /max_concurrent_threads_per_session/);
});

function sectionText(config, header) {
	const start = config.indexOf(header);
	if (start === -1) return "";
	const afterStart = config.slice(start + header.length);
	const nextSectionOffset = afterStart.search(/\n\[/);
	return nextSectionOffset === -1
		? config.slice(start)
		: config.slice(start, start + header.length + nextSectionOffset);
}
