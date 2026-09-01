#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isCliEntry } from "./entry-guard.mjs";
import { FALLBACK_CATALOG, readModelCatalog } from "./migrate-codex-config/catalog.mjs";
import { configPaths } from "./migrate-codex-config/config-paths.mjs";
import { removeStaleContext7PlaceholderMcpServer } from "./migrate-codex-config/context7-placeholder-guard.mjs";
import { removeUnsupportedRootMultiAgentMode } from "./migrate-codex-config/multi-agent-mode-guard.mjs";
import {
	forceDisableMultiAgentV2,
	resolveMultiAgentVersionFromConfig,
} from "./migrate-codex-config/multi-agent-v2-guard.mjs";
import { ensureCodexReasoningConfig as applyReasoningProfile, readRootSettings } from "./migrate-codex-config/root-settings.mjs";
import { readState, resolveStatePath, writeState } from "./migrate-codex-config/state.mjs";
import { ensureSubagentConcurrencyLimit } from "./migrate-codex-config/subagent-limit-guard.mjs";

export { readModelCatalog } from "./migrate-codex-config/catalog.mjs";

export function ensureCodexReasoningConfig(config, profile = FALLBACK_CATALOG.current) {
	return applyReasoningProfile(config, profile);
}

export async function migrateCodexConfig({
	env = process.env,
	cwd = process.cwd(),
	sessionModel = null,
	requireSessionModel = false,
} = {}) {
	const catalog = await readModelCatalog(env);
	const statePath = resolveStatePath(env);
	const state = await readState(statePath);
	const paths = await configPaths({ env, cwd });
	const changed = [];
	const modeChanged = [];
	const nextState = { catalogVersion: catalog.version, files: {} };
	for (const configPath of paths) {
		const result = await migrateConfigFile(configPath, {
			catalog,
			previousState: state.files?.[configPath],
			env,
			sessionModel,
			requireSessionModel,
		});
		if (result.changed) changed.push(configPath);
		if (result.multiAgentModeChanged) modeChanged.push(configPath);
		nextState.files[configPath] = {
			catalogVersion: catalog.version,
			written: result.written,
			managed: result.managed,
		};
	}
	await writeState(statePath, nextState);
	return { changed, modeChanged };
}

export async function migrateConfigFile(
	configPath,
	{
		catalog = FALLBACK_CATALOG,
		previousState,
		env = process.env,
		sessionModel = null,
		requireSessionModel = false,
	} = {},
) {
	const before = await readConfig(configPath);
	const decision = shouldApplyCatalog(before, catalog, previousState);

	let config = before;
	let reasoningApplied = false;

	if (decision.apply) {
		config = ensureCodexReasoningConfig(config, catalog.current);
		reasoningApplied = config !== before;
	}

	const multiAgentOptions = { env, sessionModel, requireSessionModel, configPath };
	const multiAgentVersion = resolveMultiAgentVersionFromConfig(config, multiAgentOptions);
	const afterMultiAgentGuard = forceDisableMultiAgentV2(config, {
		...multiAgentOptions,
		multiAgentVersion,
	});
	const multiAgentChanged = afterMultiAgentGuard !== config;
	if (multiAgentChanged) config = afterMultiAgentGuard;

	const afterMultiAgentModeGuard = removeUnsupportedRootMultiAgentMode(config);
	const multiAgentModeChanged = afterMultiAgentModeGuard !== config;
	if (multiAgentModeChanged) config = afterMultiAgentModeGuard;

	const afterContext7PlaceholderGuard = removeStaleContext7PlaceholderMcpServer(config);
	const context7PlaceholderChanged = afterContext7PlaceholderGuard !== config;
	if (context7PlaceholderChanged) config = afterContext7PlaceholderGuard;

	const afterSubagentLimit = ensureSubagentConcurrencyLimit(config, {
		...multiAgentOptions,
		multiAgentVersion,
	});
	const subagentLimitChanged = afterSubagentLimit !== config;
	if (subagentLimitChanged) config = afterSubagentLimit;

	const changed = reasoningApplied || multiAgentChanged || multiAgentModeChanged || context7PlaceholderChanged || subagentLimitChanged;
	if (changed) {
		await mkdir(dirname(configPath), { recursive: true });
		await writeFile(configPath, `${config.trimEnd()}\n`);
	}

	const written = decision.apply ? catalog.current : readRootSettings(config);
	const managed = decision.apply ? true : decision.managed;
	return { changed, written, managed, multiAgentModeChanged };
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

if (isCliEntry(import.meta.url)) {
	migrateCodexConfig().catch((error) => {
		if (!(error instanceof Error)) throw error;
		process.exit(0);
	});
}
