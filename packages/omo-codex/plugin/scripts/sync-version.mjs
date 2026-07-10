#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntry } from "./entry-guard.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = dirname(scriptDir);
const defaultRepoRoot = join(defaultPluginRoot, "..", "..", "..");

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function normalizeVersion(version) {
	if (typeof version !== "string") return "";
	return version.trim();
}

export async function resolveAuthoritativeVersion(options = {}) {
	const env = options.env ?? process.env;
	const explicit = normalizeVersion(options.version ?? env.LAZYCODEX_RELEASE_VERSION);
	if (explicit.length > 0) return explicit;

	const repoRoot = options.repoRoot ?? defaultRepoRoot;
	const rootVersion = normalizeVersion((await readJson(join(repoRoot, "package.json"))).version);
	if (rootVersion.length === 0) {
		throw new Error(`Cannot resolve authoritative version: ${join(repoRoot, "package.json")} has no version`);
	}
	return rootVersion;
}

async function stampJsonVersion(path, version) {
	let parsed;
	try {
		parsed = await readJson(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
	if (!("version" in parsed)) return false;
	if (parsed.version === version) return false;
	parsed.version = version;
	await writeJson(path, parsed);
	return true;
}

async function collectComponentManifests(pluginRoot) {
	const componentsRoot = join(pluginRoot, "components");
	let entries;
	try {
		entries = await readdir(componentsRoot, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	const manifests = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		manifests.push(join(componentsRoot, entry.name, "package.json"));
	}
	return manifests;
}

export function manifestTargets(pluginRoot, componentManifests) {
	const omoCodexRoot = dirname(pluginRoot);
	return [
		join(omoCodexRoot, "package.json"),
		join(pluginRoot, "package.json"),
		join(pluginRoot, ".codex-plugin", "plugin.json"),
		...componentManifests,
	];
}

export async function syncVersion(options = {}) {
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	const version = options.version ?? (await resolveAuthoritativeVersion({ ...options, version: undefined }));
	const componentManifests = await collectComponentManifests(pluginRoot);
	const targets = manifestTargets(pluginRoot, componentManifests);
	const changed = [];
	for (const target of targets) {
		if (await stampJsonVersion(target, version)) changed.push(target);
	}
	return { version, targets, changed };
}

if (isCliEntry(import.meta.url)) {
	const result = await syncVersion();
	console.log(`Synced OMO Codex manifests to version ${result.version} (${result.changed.length} updated)`);
}
