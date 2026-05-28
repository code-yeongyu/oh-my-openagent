import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { exists } from "./utils.mjs";

const LAZYCODEX_MARKETPLACE_SOURCE = {
	sourceType: "git",
	source: "https://github.com/code-yeongyu/lazycodex.git",
	ref: "main",
};
const SISYPHUS_LEGACY_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"];

export async function updateCodexConfig({
	configPath,
	repoRoot,
	marketplaceName,
	marketplaceSource = defaultMarketplaceSource(marketplaceName, repoRoot),
	pluginNames,
	trustedHookStates = [],
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
	config = ensureFeatureEnabled(config, "plugins");
	config = ensureFeatureEnabled(config, "plugin_hooks");
	config = ensureMarketplaceBlock(config, marketplaceName, marketplaceSource);
	for (const pluginName of pluginNames) {
		config = ensurePluginEnabled(config, `${pluginName}@${marketplaceName}`);
	}
	for (const state of trustedHookStates) {
		config = ensureHookTrusted(config, state.key, state.trustedHash);
	}

	await writeFile(configPath, config.trimEnd() + "\n");
}

function legacyMarketplaceNames(marketplaceName) {
	return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_MARKETPLACES : [];
}

function removeMarketplaceBlock(config, marketplaceName) {
	return removeTomlSections(config, (header) => header === `marketplaces.${marketplaceName}`);
}

function defaultMarketplaceSource(marketplaceName, repoRoot) {
	if (marketplaceName === "sisyphuslabs") return LAZYCODEX_MARKETPLACE_SOURCE;
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

function ensureHookTrusted(config, key, trustedHash) {
	const header = `hooks.state.${JSON.stringify(key)}`;
	const section = findTomlSection(config, header);
	if (!section) return appendBlock(config, `[${header}]\ntrusted_hash = ${JSON.stringify(trustedHash)}\n`);
	return replaceOrInsertSetting(config, section, "trusted_hash", JSON.stringify(trustedHash));
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
	const lines = sectionText.split("\n");
	lines.splice(1, 0, `${key} = ${value}`);
	return lines.join("\n");
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
	} catch {
		return null;
	}
}

function appendBlock(config, block) {
	const prefix = config.trimEnd();
	return `${prefix}${prefix.length > 0 ? "\n\n" : ""}${block.trimEnd()}\n`;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
