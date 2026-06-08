#!/usr/bin/env node
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { formatLazyCodexHookStatusMessage, normalizeLazyCodexHookStatusLabel } from "./hook-status-message.mjs";

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

async function readPackageVersion(path) {
	const packageJson = await readJson(path);
	return packageJson.version;
}

async function readComponentNames(root) {
	const componentsRoot = join(root, "components");
	const entries = await readdir(componentsRoot, { withFileTypes: true });
	const names = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const packageJsonPath = join(componentsRoot, entry.name, "package.json");
		if (!(await exists(packageJsonPath))) continue;
		names.push(entry.name);
	}
	return names;
}

function syncHooksJson(hooksJson, versionForCommand) {
	for (const groups of Object.values(hooksJson.hooks)) {
		for (const group of groups) {
			for (const hook of group.hooks) {
				if (hook.type !== "command") continue;
				const label = normalizeLazyCodexHookStatusLabel(hook.statusMessage);
				hook.statusMessage = formatLazyCodexHookStatusMessage(versionForCommand(hook.command), label);
			}
		}
	}
}

async function syncComponentHooks(root, componentName, version) {
	const hooksPath = join(root, "components", componentName, "hooks", "hooks.json");
	if (!(await exists(hooksPath))) return;
	const hooksJson = await readJson(hooksPath);
	syncHooksJson(hooksJson, () => version);
	await writeJson(hooksPath, hooksJson);
}

function normalizeReleaseVersion(version) {
	if (typeof version !== "string") return "";
	return version.trim();
}

function readReleaseVersion(options) {
	const releaseVersion = normalizeReleaseVersion(options.releaseVersion ?? process.env.LAZYCODEX_RELEASE_VERSION);
	if (releaseVersion.length > 0) return releaseVersion;
	return undefined;
}

export async function syncHookStatusMessages(root = defaultRoot, options = {}) {
	const releaseVersion = readReleaseVersion(options);
	const aggregateVersion = releaseVersion ?? (await readPackageVersion(join(root, ".codex-plugin", "plugin.json")));
	const componentNames = await readComponentNames(root);
	const aggregateHooksPath = join(root, "hooks", "hooks.json");
	const aggregateHooks = await readJson(aggregateHooksPath);
	syncHooksJson(aggregateHooks, () => aggregateVersion);
	await writeJson(aggregateHooksPath, aggregateHooks);

	for (const componentName of componentNames) {
		const componentVersion =
			releaseVersion ?? (await readPackageVersion(join(root, "components", componentName, "package.json")));
		await syncComponentHooks(root, componentName, componentVersion);
	}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await syncHookStatusMessages();
}
