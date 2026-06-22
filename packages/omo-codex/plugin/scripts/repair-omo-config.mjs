#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { trustedHookStatesForPlugin } from "./hook-trust-discovery.mjs";

const MARKETPLACE_NAME = "sisyphuslabs";
const PLUGIN_NAME = "omo";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const MANAGED_CODEX_AGENT_NAMES = new Set([
	"codex-ultrawork-reviewer",
	"explorer",
	"librarian",
	"metis",
	"momus",
	"plan",
]);
const MAX_REPAIR_BACKUPS = 5;
const REPAIR_BACKUP_SUFFIX = ".bak-omo-repair-";
export async function repairOmoCodexConfig({ env = process.env, codexHome = resolveCodexHome(env), platform = process.platform, now = () => new Date() } = {}) {
	const installState = await discoverOmoInstallState({ codexHome, platform });
	if (installState === null) return { repaired: false, reason: "not-installed" };

	const configPath = join(codexHome, "config.toml");
	const before = await readConfig(configPath);
	if (isOmoConfigHealthy(before, installState)) {
		return { repaired: false, reason: "ok" };
	}

	const after = applyOmoConfigRepair(before, installState);
	if (after === before) return { repaired: false, reason: "unchanged" };

	await mkdir(dirname(configPath), { recursive: true });
	const backupPath = await writeConfigBackup(configPath, before, now);
	await writeFile(configPath, `${after.trimEnd()}\n`);
	return { repaired: true, reason: "restored", configPath, backupPath };
}

export async function discoverOmoInstallState({ codexHome, platform = process.platform }) {
	const pluginRoot = await resolveInstalledPluginRoot(codexHome);
	if (pluginRoot === null) return null;

	const marketplaceRoot = join(codexHome, "plugins", "cache", MARKETPLACE_NAME);
	const trustedHookStates = await trustedHookStatesForPlugin({
		marketplaceName: MARKETPLACE_NAME,
		pluginName: PLUGIN_NAME,
		pluginRoot,
	});
	const agentConfigs = await discoverManagedAgentConfigs(codexHome);
	return {
		marketplaceName: MARKETPLACE_NAME,
		marketplaceSource: {
			sourceType: "local",
			source: marketplaceRoot,
		},
		pluginNames: [PLUGIN_NAME],
		platform,
		trustedHookStates,
		agentConfigs,
		pluginRoot,
	};
}

export function isOmoConfigHealthy(config, installState) {
	if (!findTomlSection(config, `marketplaces.${installState.marketplaceName}`)) return false;
	const pluginSection = findTomlSection(config, `plugins.${JSON.stringify(PLUGIN_KEY)}`);
	if (!pluginSection) return false;
	return /^\s*enabled\s*=\s*true\s*$/m.test(pluginSection.text);
}

export function applyOmoConfigRepair(config, installState) {
	let next = config;
	next = ensureFeatureEnabled(next, "plugins");
	next = ensureFeatureEnabled(next, "plugin_hooks");
	next = ensureFeatureEnabled(next, "multi_agent");
	next = ensureFeatureEnabled(next, "child_agents_md");
	next = ensureMarketplaceBlock(next, installState.marketplaceName, installState.marketplaceSource);
	for (const pluginName of installState.pluginNames) {
		next = ensurePluginEnabled(next, `${pluginName}@${installState.marketplaceName}`);
	}
	next = ensureOmoBuiltinMcpPolicies(next, installState);
	for (const state of installState.trustedHookStates) {
		next = ensureHookTrusted(next, state.key, state.trustedHash);
	}
	for (const agentConfig of installState.agentConfigs) {
		next = ensureAgentConfig(next, agentConfig);
	}
	return next;
}

async function resolveInstalledPluginRoot(codexHome) {
	const pluginCacheRoot = join(codexHome, "plugins", "cache", MARKETPLACE_NAME, PLUGIN_NAME);
	let entries;
	try {
		entries = await readdir(pluginCacheRoot, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}

	const versions = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareVersionLabels);
	if (versions.length === 0) return null;
	return join(pluginCacheRoot, versions[versions.length - 1]);
}

async function discoverManagedAgentConfigs(codexHome) {
	const agentsDir = join(codexHome, "agents");
	let entries;
	try {
		entries = await readdir(agentsDir, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}

	const configs = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
		const agentName = entry.name.slice(0, -".toml".length);
		if (!MANAGED_CODEX_AGENT_NAMES.has(agentName)) continue;
		configs.push({ name: agentName, configFile: `./agents/${entry.name}` });
	}
	return configs.sort((left, right) => left.name.localeCompare(right.name));
}

function ensureFeatureEnabled(config, featureName) {
	const section = findTomlSection(config, "features");
	if (!section) return appendBlock(config, `[features]\n${featureName} = true\n`);
	return replaceOrInsertSetting(config, section, featureName, "true");
}

function ensureMarketplaceBlock(config, marketplaceName, source) {
	const header = `marketplaces.${marketplaceName}`;
	const block = [
		`[${header}]`,
		`last_updated = "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"`,
		`source_type = ${JSON.stringify(source.sourceType)}`,
		`source = ${JSON.stringify(source.source)}`,
		source.ref === undefined ? null : `ref = ${JSON.stringify(source.ref)}`,
		"",
	].filter((line) => line !== null).join("\n");
	const section = findTomlSection(config, header);
	if (section) return config.slice(0, section.start) + block + config.slice(section.end);
	return appendBlock(config, block);
}

function ensurePluginEnabled(config, pluginKey) {
	const header = `plugins.${JSON.stringify(pluginKey)}`;
	const section = findTomlSection(config, header);
	if (!section) return appendBlock(config, `[${header}]\nenabled = true\n`);
	return replaceOrInsertSetting(config, section, "enabled", "true");
}

function ensurePluginMcpEnabled(config, pluginKey, serverName, enabled) {
	const header = `plugins.${JSON.stringify(pluginKey)}.mcp_servers.${serverName}`;
	const section = findTomlSection(config, header);
	const enabledValue = enabled ? "true" : "false";
	if (!section) return appendBlock(config, `[${header}]\nenabled = ${enabledValue}\n`);
	return replaceOrInsertSetting(config, section, "enabled", enabledValue);
}

function ensureOmoBuiltinMcpPolicies(config, installState) {
	if (installState.marketplaceName !== MARKETPLACE_NAME || !installState.pluginNames.includes(PLUGIN_NAME)) return config;
	let nextConfig = ensurePluginMcpEnabled(config, PLUGIN_KEY, "context7", true);
	nextConfig = ensurePluginMcpEnabled(nextConfig, PLUGIN_KEY, "git_bash", installState.platform === "win32");
	return nextConfig;
}

function ensureHookTrusted(config, key, trustedHash) {
	const header = `hooks.state.${JSON.stringify(key)}`;
	const section = findTomlSection(config, header);
	if (!section) return appendBlock(config, `[${header}]\ntrusted_hash = ${JSON.stringify(trustedHash)}\n`);
	return replaceOrInsertSetting(config, section, "trusted_hash", JSON.stringify(trustedHash));
}

function ensureAgentConfig(config, agentConfig) {
	const header = `agents.${tomlKeySegment(agentConfig.name)}`;
	const section = findTomlSection(config, header);
	const configFile = JSON.stringify(agentConfig.configFile);
	if (!section) return appendBlock(config, `[${header}]\nconfig_file = ${configFile}\n`);
	return replaceOrInsertSetting(config, section, "config_file", configFile);
}

function tomlKeySegment(value) {
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function findTomlSection(config, header) {
	const headerLine = `[${header}]`;
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let start = -1;
	for (const line of lines) {
		if (line.length === 0) break;
		const trimmed = line.trim();
		if (start === -1) {
			if (trimmed === headerLine) start = offset;
		} else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			return { start, end: offset, text: config.slice(start, offset) };
		}
		offset += line.length;
	}
	if (start === -1) return null;
	return { start, end: config.length, text: config.slice(start) };
}

function replaceOrInsertSetting(config, section, key, value) {
	const linePattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m");
	const replacement = linePattern.test(section.text)
		? section.text.replace(linePattern, `${key} = ${value}`)
		: insertSetting(section.text, key, value);
	return config.slice(0, section.start) + replacement + config.slice(section.end);
}

function insertSetting(sectionText, key, value) {
	const trimmed = sectionText.trimEnd();
	return `${trimmed}\n${key} = ${value}\n`;
}

function appendBlock(config, block) {
	const prefix = config.trimEnd();
	return `${prefix}${prefix.length > 0 ? "\n\n" : ""}${block.trimEnd()}\n`;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readConfig(configPath) {
	try {
		return await readFile(configPath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}

async function writeConfigBackup(configPath, content, now) {
	if (content.trim().length === 0) return undefined;
	const timestamp = formatBackupTimestamp(now());
	const backupPath = `${configPath}${REPAIR_BACKUP_SUFFIX}${timestamp}`;
	await writeFile(backupPath, content);
	await pruneRepairBackups(configPath);
	return backupPath;
}

async function pruneRepairBackups(configPath) {
	const configDir = dirname(configPath);
	const prefix = `${basename(configPath)}${REPAIR_BACKUP_SUFFIX}`;
	let entries;
	try {
		entries = await readdir(configDir);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw error;
	}

	const backups = entries
		.filter((name) => name.startsWith(prefix))
		.sort(compareRepairBackupNames)
		.reverse();
	for (const name of backups.slice(MAX_REPAIR_BACKUPS)) {
		await rm(join(configDir, name), { force: true });
	}
}

function compareRepairBackupNames(left, right) {
	const leftTimestamp = left.slice(left.lastIndexOf(REPAIR_BACKUP_SUFFIX) + REPAIR_BACKUP_SUFFIX.length);
	const rightTimestamp = right.slice(right.lastIndexOf(REPAIR_BACKUP_SUFFIX) + REPAIR_BACKUP_SUFFIX.length);
	return leftTimestamp.localeCompare(rightTimestamp);
}

function formatBackupTimestamp(date) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function resolveCodexHome(env) {
	const value = env.CODEX_HOME?.trim();
	return value && value.length > 0 ? value : join(homedir(), ".codex");
}

function compareVersionLabels(left, right) {
	const leftParts = parseVersionLabel(left);
	const rightParts = parseVersionLabel(right);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
		const leftValue = leftParts[index] ?? 0;
		const rightValue = rightParts[index] ?? 0;
		if (leftValue !== rightValue) return leftValue - rightValue;
	}
	return left.localeCompare(right);
}

function parseVersionLabel(value) {
	return value.split(/[.-]/).map((part) => {
		const numeric = Number.parseInt(part, 10);
		return Number.isFinite(numeric) ? numeric : 0;
	});
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	repairOmoCodexConfig()
		.then((result) => {
			if (result.repaired) {
				console.log(`Repaired OMO Codex config (${result.reason}). Backup: ${result.backupPath ?? "none"}`);
				return;
			}
			console.log(`OMO Codex config repair skipped (${result.reason}).`);
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
