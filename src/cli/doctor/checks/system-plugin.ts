import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	CONFIG_BASENAME,
	getOpenCodeConfigPaths,
	LEGACY_CONFIG_BASENAME,
	LEGACY_PLUGIN_NAME,
	PLUGIN_NAME,
	parseJsonc,
} from "../../../shared";

export interface PluginInfo {
	registered: boolean;
	configPath: string | null;
	entry: string | null;
	isPinned: boolean;
	pinnedVersion: string | null;
	isLocalDev: boolean;
}

interface OpenCodeConfigShape {
	plugin?: string[];
}

export interface PluginConfigFileState {
	canonicalJsoncPath: string;
	canonicalJsonPath: string;
	canonicalPaths: string[];
	canonicalPath: string | null;
	legacyJsoncPath: string;
	legacyJsonPath: string;
	legacyPaths: string[];
	hasCanonical: boolean;
	hasMultipleCanonical: boolean;
	hasLegacy: boolean;
}

function detectConfigPath(): string | null {
	const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null });
	if (existsSync(paths.configJsonc)) return paths.configJsonc;
	if (existsSync(paths.configJson)) return paths.configJson;
	return null;
}

export function getPluginConfigFileState(): PluginConfigFileState {
	const { configDir } = getOpenCodeConfigPaths({
		binary: "opencode",
		version: null,
	});
	const canonicalJsoncPath = join(configDir, `${CONFIG_BASENAME}.jsonc`);
	const canonicalJsonPath = join(configDir, `${CONFIG_BASENAME}.json`);
	const legacyJsoncPath = join(configDir, `${LEGACY_CONFIG_BASENAME}.jsonc`);
	const legacyJsonPath = join(configDir, `${LEGACY_CONFIG_BASENAME}.json`);

	const canonicalPath = existsSync(canonicalJsoncPath)
		? canonicalJsoncPath
		: existsSync(canonicalJsonPath)
			? canonicalJsonPath
			: null;
	const canonicalPaths = [canonicalJsoncPath, canonicalJsonPath].filter(
		(path) => existsSync(path),
	);

	const legacyPaths = [legacyJsoncPath, legacyJsonPath].filter((path) =>
		existsSync(path),
	);

	return {
		canonicalJsoncPath,
		canonicalJsonPath,
		canonicalPaths,
		canonicalPath,
		legacyJsoncPath,
		legacyJsonPath,
		legacyPaths,
		hasCanonical: canonicalPath !== null,
		hasMultipleCanonical: canonicalPaths.length > 1,
		hasLegacy: legacyPaths.length > 0,
	};
}

function parsePluginVersion(entry: string): string | null {
	// Check for current package name
	if (entry.startsWith(`${PLUGIN_NAME}@`)) {
		const value = entry.slice(PLUGIN_NAME.length + 1);
		if (!value || value === "latest") return null;
		return value;
	}
	// Check for legacy package name
	if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
		const value = entry.slice(LEGACY_PLUGIN_NAME.length + 1);
		if (!value || value === "latest") return null;
		return value;
	}
	return null;
}

function findPluginEntry(
	entries: string[],
): { entry: string; isLocalDev: boolean } | null {
	for (const entry of entries) {
		// Check for current package name
		if (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)) {
			return { entry, isLocalDev: false };
		}
		// Check for legacy package name
		if (
			entry === LEGACY_PLUGIN_NAME ||
			entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)
		) {
			return { entry, isLocalDev: false };
		}
		// Check for file:// paths that include either name
		if (
			entry.startsWith("file://") &&
			(entry.includes(PLUGIN_NAME) || entry.includes(LEGACY_PLUGIN_NAME))
		) {
			return { entry, isLocalDev: true };
		}
	}

	return null;
}

export function getPluginInfo(): PluginInfo {
	const configPath = detectConfigPath();
	if (!configPath) {
		return {
			registered: false,
			configPath: null,
			entry: null,
			isPinned: false,
			pinnedVersion: null,
			isLocalDev: false,
		};
	}

	try {
		const content = readFileSync(configPath, "utf-8");
		const parsedConfig = parseJsonc<OpenCodeConfigShape>(content);
		const pluginEntry = findPluginEntry(parsedConfig.plugin ?? []);
		if (!pluginEntry) {
			return {
				registered: false,
				configPath,
				entry: null,
				isPinned: false,
				pinnedVersion: null,
				isLocalDev: false,
			};
		}

		const pinnedVersion = parsePluginVersion(pluginEntry.entry);
		return {
			registered: true,
			configPath,
			entry: pluginEntry.entry,
			isPinned:
				pinnedVersion !== null && /^\d+\.\d+\.\d+/.test(pinnedVersion ?? ""),
			pinnedVersion,
			isLocalDev: pluginEntry.isLocalDev,
		};
	} catch {
		return {
			registered: false,
			configPath,
			entry: null,
			isPinned: false,
			pinnedVersion: null,
			isLocalDev: false,
		};
	}
}

export { detectConfigPath, findPluginEntry };
