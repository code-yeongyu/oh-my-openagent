import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { manifestTargets, resolveAuthoritativeVersion, syncVersion } from "../scripts/sync-version.mjs";

async function makeTempDir() {
	return mkdtemp(join(tmpdir(), "omo-codex-sync-version-"));
}

async function writeJson(path, value) {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function scaffoldPlugin(repoRoot, rootVersion) {
	await writeJson(join(repoRoot, "package.json"), { name: "oh-my-opencode", version: rootVersion });
	const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	await writeJson(join(repoRoot, "packages", "omo-codex", "package.json"), { name: "@oh-my-opencode/omo-codex", version: "0.1.0" });
	await writeJson(join(pluginRoot, "package.json"), { name: "@sisyphuslabs/omo-codex-plugin", version: "0.1.0" });
	await writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), { name: "omo", version: "0.1.0" });
	await writeJson(join(pluginRoot, "components", "rules", "package.json"), { name: "@code-yeongyu/codex-rules", version: "0.1.0" });
	await writeJson(join(pluginRoot, "components", "rules", ".codex-plugin", "plugin.json"), { hooks: "./hooks/hooks.json" });
	return pluginRoot;
}

test("#given LAZYCODEX_RELEASE_VERSION env #when resolving authoritative version #then the env value wins", async () => {
	const version = await resolveAuthoritativeVersion({ env: { LAZYCODEX_RELEASE_VERSION: "9.9.9" }, repoRoot: "/nonexistent" });
	assert.equal(version, "9.9.9");
});

test("#given no env override #when resolving authoritative version #then root package.json version is used", async () => {
	const repoRoot = await makeTempDir();
	await writeJson(join(repoRoot, "package.json"), { name: "oh-my-opencode", version: "4.8.1" });
	const version = await resolveAuthoritativeVersion({ env: {}, repoRoot });
	assert.equal(version, "4.8.1");
});

test("#given drifted Codex manifests #when syncing version from root #then all versioned manifests match and version-less files are left alone", async () => {
	const repoRoot = await makeTempDir();
	const pluginRoot = await scaffoldPlugin(repoRoot, "4.8.1");

	const result = await syncVersion({ pluginRoot, env: {}, repoRoot });

	assert.equal(result.version, "4.8.1");
	for (const target of manifestTargets(pluginRoot, [join(pluginRoot, "components", "rules", "package.json")])) {
		assert.equal((await readJson(target)).version, "4.8.1", `expected ${target} to be stamped`);
	}
	// the version-less component plugin.json must not gain a version field
	const versionlessManifest = await readJson(join(pluginRoot, "components", "rules", ".codex-plugin", "plugin.json"));
	assert.equal("version" in versionlessManifest, false);
});

test("#given already coherent manifests #when syncing again #then nothing is rewritten", async () => {
	const repoRoot = await makeTempDir();
	const pluginRoot = await scaffoldPlugin(repoRoot, "4.8.1");

	await syncVersion({ pluginRoot, env: {}, repoRoot });
	const second = await syncVersion({ pluginRoot, env: {}, repoRoot });

	assert.equal(second.changed.length, 0);
});
