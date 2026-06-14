import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ensureCodexMultiAgentV2Config } from "./multi-agent-v2-config.mjs";
import { readCodexModelCatalog } from "./model-catalog.mjs";
import { ensureCodexReasoningConfig } from "./reasoning-config.mjs";
import { ensureAutonomousPermissions } from "./permissions.mjs";
import { appendBlock, findTomlSection, replaceOrInsertSetting } from "./toml-editor.mjs";
import { exists } from "./utils.mjs";

const LEGACY_CODEX_PLUGIN_MARKETPLACE = ["code", "yeongyu", "codex", "plugins"].join("-");
const SISYPHUS_LEGACY_MARKETPLACES = ["lazycodex", LEGACY_CODEX_PLUGIN_MARKETPLACE];
const MANAGED_CODEX_AGENT_NAMES = [
	"codex-ultrawork-reviewer",
	"explorer",
	"librarian",
	"metis",
	"momus",
	"plan",
];

export async function updateCodexConfig({
	configPath,
	repoRoot,
	marketplaceName,
	marketplaceSource = defaultMarketplaceSource(repoRoot),
	preserveMarketplaceSource = false,
	pluginNames,
	platform = process.platform,
	trustedHookStates = [],
	agentConfigs = [],
	autonomousPermissions = false,
	gitBashEnabled = false,
}) {
	await mkdir(dirname(configPath), { recursive: true });
	let config = "";
	if (await exists(configPath)) config = await readFile(configPath, "utf8");

	for (const legacyMarketplaceName of legacyMarketplaceNames(marketplaceName)) {
		config = removeMarketplaceBlock(config, legacyMarketplaceName);
		config = removeStaleMarketplacePluginBlocks(config, legacyMarketplaceName, new Set());
		config = removeStaleMarketplaceHookStateBlocks(config, legacyMarketplaceName, new Set());
	}
	config = removeStaleMarketplacePluginBlocks(config, marketplaceName, new Set(pluginNames));
	config = removeStaleMarketplaceHookStateBlocks(config, marketplaceName, new Set(pluginNames));
	config = removeStaleManagedAgentBlocks(config, new Set(agentConfigs.map((agentConfig) => agentConfig.name)));
	config = ensureFeatureEnabled(config, "plugins");
	config = ensureFeatureEnabled(config, "plugin_hooks");
	config = ensureFeatureEnabled(config, "multi_agent");
	config = ensureFeatureEnabled(config, "child_agents_md");
	config = ensureCodexReasoningConfig(config, await readCodexModelCatalog(repoRoot));
	config = ensureCodexMultiAgentV2Config(config);
	if (autonomousPermissions === true) config = ensureAutonomousPermissions(config);
	// Marketplace-flow bootstrap (preserveMarketplaceSource) must keep the
	// Codex-managed [marketplaces.<name>] block byte-identical: rewriting it
	// would replace the git source with a local one and bump last_updated on
	// every worker run. When the block is absent we write nothing rather than
	// invent a source.
	if (preserveMarketplaceSource !== true) {
		config = ensureMarketplaceBlock(config, marketplaceName, marketplaceSource);
	}
	for (const pluginName of pluginNames) {
		config = ensurePluginEnabled(config, `${pluginName}@${marketplaceName}`);
	}
	config = ensureOmoBuiltinMcpPolicies(config, { marketplaceName, pluginNames, platform, gitBashEnabled });
	for (const state of trustedHookStates) {
		config = ensureHookTrusted(config, state.key, state.trustedHash);
	}
	for (const agentConfig of agentConfigs) {
		config = ensureAgentConfig(config, agentConfig);
	}

	await writeFile(configPath, config.trimEnd() + "\n");
}

function legacyMarketplaceNames(marketplaceName) {
	return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_MARKETPLACES : [];
}

function removeMarketplaceBlock(config, marketplaceName) {
	return removeTomlSections(config, (header) => header === `marketplaces.${marketplaceName}`);
}

function defaultMarketplaceSource(repoRoot) {
	return {
		sourceType: "local",
		source: repoRoot,
	};
}

function removeStaleMarketplacePluginBlocks(config, marketplaceName, keepPluginNames) {
	return removeTomlSections(config, (header) => {
		const pluginKey = parsePluginHeaderKey(header);
		if (pluginKey === null) return false;
		const suffix = `@${marketplaceName}`;
		if (!pluginKey.endsWith(suffix)) return false;
		return !keepPluginNames.has(pluginKey.slice(0, -suffix.length));
	});
}

function removeStaleMarketplaceHookStateBlocks(config, marketplaceName, keepPluginNames) {
	return removeTomlSections(config, (header) => {
		const prefix = "hooks.state.";
		if (!header.startsWith(prefix)) return false;
		const hookKey = parseJsonString(header.slice(prefix.length));
		if (hookKey === null) return false;
		const separator = hookKey.indexOf(":");
		if (separator === -1) return false;
		const pluginKey = hookKey.slice(0, separator);
		const suffix = `@${marketplaceName}`;
		if (!pluginKey.endsWith(suffix)) return false;
		return !keepPluginNames.has(pluginKey.slice(0, -suffix.length));
	});
}

function removeStaleManagedAgentBlocks(config, keepAgentNames) {
	const managedAgentNames = new Set(MANAGED_CODEX_AGENT_NAMES);
	return splitTomlSections(config)
		.filter((section) => {
			if (section.header === null) return true;
			const agentName = parseAgentHeaderName(section.header);
			if (agentName === null || !managedAgentNames.has(agentName) || keepAgentNames.has(agentName)) return true;
			return !section.text.includes(`config_file = ${JSON.stringify(`./agents/${agentName}.toml`)}`);
		})
		.map((section) => section.text)
		.join("")
		.replace(/\n{3,}/g, "\n\n");
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

function ensureOmoBuiltinMcpPolicies(config, { marketplaceName, pluginNames, platform, gitBashEnabled }) {
	if (marketplaceName !== "sisyphuslabs" || !pluginNames.includes("omo")) return config;
	let nextConfig = ensurePluginMcpEnabled(config, "omo@sisyphuslabs", "context7", true);
	nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "git_bash", platform === "win32" && gitBashEnabled === true);
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

function removeTomlSections(config, shouldRemove) {
	return splitTomlSections(config)
		.filter((section) => section.header === null || !shouldRemove(section.header))
		.map((section) => section.text)
		.join("")
		.replace(/\n{3,}/g, "\n\n");
}

function splitTomlSections(config) {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	const sections = [];
	let current = { header: null, text: "" };
	for (const line of lines) {
		if (line.length === 0) break;
		const header = parseTomlHeader(line);
		if (header !== null) {
			if (current.text.length > 0) sections.push(current);
			current = { header, text: line };
		} else {
			current.text += line;
		}
	}
	if (current.text.length > 0) sections.push(current);
	return sections;
}

function parseTomlHeader(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
	if (trimmed.startsWith("[[")) return null;
	return trimmed.slice(1, -1);
}

function parsePluginHeaderKey(header) {
	const prefix = "plugins.";
	if (!header.startsWith(prefix)) return null;
	return parseLeadingJsonString(header.slice(prefix.length));
}

function parseAgentHeaderName(header) {
	const prefix = "agents.";
	if (!header.startsWith(prefix)) return null;
	const key = header.slice(prefix.length);
	return key.startsWith('"') ? parseLeadingJsonString(key) : key;
}

function parseLeadingJsonString(value) {
	if (!value.startsWith('"')) return parseJsonString(value);
	let escaped = false;
	for (let index = 1; index < value.length; index += 1) {
		const char = value[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') return parseJsonString(value.slice(0, index + 1));
	}
	return null;
}

function parseJsonString(value) {
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === "string" ? parsed : null;
	} catch (error) {
		if (error instanceof Error) return null;
		return null;
	}
}

