#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MANIFEST_FILE = "global-skills-manifest.json";

export async function syncOmoGlobalSkills({
	codexHome = resolveCodexHome(process.env),
	pluginRoot,
	now = () => new Date(),
} = {}) {
	if (typeof pluginRoot !== "string" || pluginRoot.trim().length === 0) {
		return { synced: false, reason: "missing-plugin-root", skills: [] };
	}

	const sourceRoot = join(pluginRoot, "skills");
	let sourceEntries;
	try {
		sourceEntries = await readdir(sourceRoot, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { synced: false, reason: "missing-plugin-skills", skills: [] };
		}
		throw error;
	}

	const skillNames = sourceEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => name !== ".system")
		.sort();

	if (skillNames.length === 0) {
		return { synced: false, reason: "empty-plugin-skills", skills: [] };
	}

	const targetRoot = join(codexHome, "skills");
	await mkdir(targetRoot, { recursive: true });

	const manifestPath = resolveManifestPath(codexHome);
	const previousManifest = await readManifest(manifestPath);
	const syncedSkills = [];
	const skippedSkills = [];

	for (const skillName of skillNames) {
		const sourcePath = join(sourceRoot, skillName);
		const targetPath = join(targetRoot, skillName);
		const hasSkillFile = await exists(join(sourcePath, "SKILL.md"));
		if (!hasSkillFile) continue;

		const previousManaged = previousManifest.skills.includes(skillName);
		const targetExists = await exists(targetPath);
		if (targetExists && !previousManaged) {
			skippedSkills.push({ name: skillName, reason: "user-owned" });
			continue;
		}

		await rm(targetPath, { recursive: true, force: true });
		await cp(sourcePath, targetPath, { recursive: true });
		syncedSkills.push(skillName);
	}

	for (const staleSkillName of previousManifest.skills) {
		if (skillNames.includes(staleSkillName)) continue;
		const stalePath = join(targetRoot, staleSkillName);
		if (await exists(stalePath)) {
			await rm(stalePath, { recursive: true, force: true });
		}
	}

	await writeManifest(manifestPath, {
		version: await readPluginVersion(pluginRoot),
		skills: syncedSkills,
		skipped: skippedSkills,
		syncedAt: now().toISOString(),
		source: sourceRoot,
	});

	return {
		synced: syncedSkills.length > 0,
		reason: syncedSkills.length > 0 ? "synced" : "unchanged",
		skills: syncedSkills,
		skipped: skippedSkills,
		manifestPath,
	};
}

export async function removeManagedOmoGlobalSkills({ codexHome = resolveCodexHome(process.env) } = {}) {
	const manifestPath = resolveManifestPath(codexHome);
	const manifest = await readManifest(manifestPath);
	const targetRoot = join(codexHome, "skills");
	const removed = [];

	for (const skillName of manifest.skills) {
		const targetPath = join(targetRoot, skillName);
		if (!(await exists(targetPath))) continue;
		await rm(targetPath, { recursive: true, force: true });
		removed.push(skillName);
	}

	await rm(manifestPath, { force: true });
	return { removed, manifestPath };
}

function resolveManifestPath(codexHome) {
	return join(codexHome, "plugins", "data", "omo-sisyphuslabs", MANIFEST_FILE);
}

async function readManifest(manifestPath) {
	try {
		const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
		return {
			skills: Array.isArray(parsed.skills) ? parsed.skills.filter((value) => typeof value === "string") : [],
		};
	} catch (error) {
		if (error instanceof Error) return { skills: [] };
		throw error;
	}
}

async function writeManifest(manifestPath, manifest) {
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function readPluginVersion(pluginRoot) {
	try {
		const parsed = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
		return typeof parsed.version === "string" ? parsed.version : "unknown";
	} catch (error) {
		if (error instanceof Error) return "unknown";
		throw error;
	}
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

function resolveCodexHome(env = process.env) {
	const value = env.CODEX_HOME?.trim();
	return value && value.length > 0 ? value : join(homedir(), ".codex");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	syncOmoGlobalSkills({
		pluginRoot: process.env.OMO_PLUGIN_ROOT?.trim() || dirname(dirname(fileURLToPath(import.meta.url))),
	})
		.then((result) => {
			if (!result.synced) {
				console.log(`OMO global skill sync skipped (${result.reason}).`);
				return;
			}
			console.log(`Synced ${result.skills.length} OMO skill(s) to ~/.codex/skills: ${result.skills.join(", ")}`);
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}