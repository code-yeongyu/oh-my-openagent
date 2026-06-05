#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { FALLBACK_CATALOG, readModelCatalog } from "./migrate-codex-config/catalog.mjs";
import { configPaths } from "./migrate-codex-config/config-paths.mjs";
import { ensureCodexReasoningConfig as applyReasoningProfile, readRootSettings } from "./migrate-codex-config/root-settings.mjs";
import { readState, resolveStatePath, writeState } from "./migrate-codex-config/state.mjs";

export { readModelCatalog } from "./migrate-codex-config/catalog.mjs";

export function ensureCodexReasoningConfig(config, profile = FALLBACK_CATALOG.current) {
	return applyReasoningProfile(config, profile);
}

export async function migrateCodexConfig({ env = process.env, cwd = process.cwd() } = {}) {
	const catalog = await readModelCatalog(env);
	const statePath = resolveStatePath(env);
	const state = await readState(statePath);
	const paths = await configPaths({ env, cwd });
	const changed = [];
	const nextState = { catalogVersion: catalog.version, files: {} };
	for (const configPath of paths) {
		const result = await migrateConfigFile(configPath, {
			catalog,
			previousState: state.files?.[configPath],
		});
		if (result.changed) changed.push(configPath);
		nextState.files[configPath] = {
			catalogVersion: catalog.version,
			written: result.written,
			managed: result.managed,
		};
	}
	await writeState(statePath, nextState);
	return { changed };
}

export async function migrateConfigFile(configPath, { catalog = FALLBACK_CATALOG, previousState } = {}) {
	const before = await readConfig(configPath);
	const decision = shouldApplyCatalog(before, catalog, previousState);
	if (!decision.apply) return { changed: false, written: readRootSettings(before), managed: decision.managed };
	const after = ensureCodexReasoningConfig(before, catalog.current);
	if (after === before) return { changed: false, written: catalog.current, managed: true };
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(configPath, `${after.trimEnd()}\n`);
	return { changed: true, written: catalog.current, managed: true };
}

function shouldApplyCatalog(config, catalog, previousState) {
	const current = readRootSettings(config);
	if (Object.keys(current).length === 0) return { apply: true, reason: "empty" };
	if (matchesProfile(current, catalog.current)) return { apply: false, reason: "current", managed: true };
	if (previousState?.managed === true && matchesProfile(current, previousState.written)) {
		return { apply: true, reason: "managed-state" };
	}
	for (const profile of catalog.managedProfiles) {
		if (matchesProfile(current, profile.match)) return { apply: true, reason: profile.version };
	}
	return { apply: false, reason: "user-modified", managed: false };
}

function matchesProfile(current, profile) {
	if (!isRecord(profile)) return false;
	for (const [key, value] of Object.entries(profile)) {
		if (current[key] !== value) return false;
	}
	return true;
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readConfig(configPath) {
	try {
		return await readFile(configPath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	migrateCodexConfig().catch((error) => {
		if (!(error instanceof Error)) throw error;
		process.exit(0);
	});
}
