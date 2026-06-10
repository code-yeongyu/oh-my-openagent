import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { removeManagedOmoGlobalSkills, syncOmoGlobalSkills } from "../scripts/sync-global-skills.mjs";

const SOURCE_PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function seedPluginCache(codexHome) {
	const cacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0");
	await mkdir(join(cacheRoot, ".codex-plugin"), { recursive: true });
	await cp(join(SOURCE_PLUGIN_ROOT, ".codex-plugin", "plugin.json"), join(cacheRoot, ".codex-plugin", "plugin.json"));
	await cp(join(SOURCE_PLUGIN_ROOT, "skills"), join(cacheRoot, "skills"), { recursive: true });
	return cacheRoot;
}

test("#given installed omo plugin cache #when syncing global skills #then copies plugin skills into ~/.codex/skills", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-sync-global-skills-"));
	const codexHome = join(root, "codex-home");
	const pluginRoot = await seedPluginCache(codexHome);

	const result = await syncOmoGlobalSkills({ codexHome, pluginRoot });
	assert.equal(result.synced, true);
	assert.ok(result.skills.includes("ulw-loop"));
	assert.ok(await readFile(join(codexHome, "skills", "ulw-loop", "SKILL.md"), "utf8"));
});

test("#given user-owned skill with same name #when syncing global skills #then preserves user-owned skill", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-sync-global-skills-user-owned-"));
	const codexHome = join(root, "codex-home");
	const pluginRoot = await seedPluginCache(codexHome);
	await mkdir(join(codexHome, "skills", "ulw-loop"), { recursive: true });
	await writeFile(join(codexHome, "skills", "ulw-loop", "SKILL.md"), "# user-owned\n");

	const result = await syncOmoGlobalSkills({ codexHome, pluginRoot });
	assert.equal(result.synced, true);
	assert.deepEqual(
		result.skipped.find((entry) => entry.name === "ulw-loop"),
		{ name: "ulw-loop", reason: "user-owned" },
	);
	assert.match(await readFile(join(codexHome, "skills", "ulw-loop", "SKILL.md"), "utf8"), /user-owned/);
});

test("#given managed global skills manifest #when uninstall cleanup runs #then only managed skills are removed", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-sync-global-skills-cleanup-"));
	const codexHome = join(root, "codex-home");
	const pluginRoot = await seedPluginCache(codexHome);
	await syncOmoGlobalSkills({ codexHome, pluginRoot });
	await mkdir(join(codexHome, "skills", "nature-reader"), { recursive: true });
	await writeFile(join(codexHome, "skills", "nature-reader", "SKILL.md"), "# keep\n");

	const removed = await removeManagedOmoGlobalSkills({ codexHome });
	assert.ok(removed.removed.includes("ulw-loop"));
	assert.match(await readFile(join(codexHome, "skills", "nature-reader", "SKILL.md"), "utf8"), /keep/);
});