import {
	parseHookStateHeaderKey,
	parsePluginHeaderKey,
	removeTomlSections,
} from "./codex-config-toml-sections";
import { findTomlAssignment } from "./toml-lexical-lines";
import { appendBlock, findTomlSection } from "./toml-section-editor";
import type { CodexMarketplaceSource } from "./types";

const SISYPHUS_LEGACY_MARKETPLACES = [
	"lazycodex",
	"code-yeongyu-codex-plugins",
] as const;

export function legacyMarketplaceNames(
	marketplaceName: string,
): readonly string[] {
	return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_MARKETPLACES : [];
}

export function removeMarketplaceBlock(
	config: string,
	marketplaceName: string,
): string {
	return removeTomlSections(
		config,
		(header) => header === `marketplaces.${marketplaceName}`,
	);
}

export function hasMarketplaceBlock(
	config: string,
	marketplaceName: string,
): boolean {
	return findTomlSection(config, `marketplaces.${marketplaceName}`) !== null;
}

export function removeStaleMarketplacePluginBlocks(
	config: string,
	marketplaceName: string,
	keepPluginNames: Set<string>,
): string {
	return removeTomlSections(config, (header) => {
		const pluginKey = parsePluginHeaderKey(header);
		if (pluginKey === null) return false;
		const suffix = `@${marketplaceName}`;
		if (!pluginKey.endsWith(suffix)) return false;
		return !keepPluginNames.has(pluginKey.slice(0, -suffix.length));
	});
}

export function removeStaleMarketplaceHookStateBlocks(
	config: string,
	marketplaceName: string,
	keepPluginNames: Set<string>,
): string {
	return removeTomlSections(config, (header) => {
		const hookKey = parseHookStateHeaderKey(header);
		if (hookKey === null) return false;
		const separator = hookKey.indexOf(":");
		if (separator === -1) return false;
		const pluginKey = hookKey.slice(0, separator);
		const suffix = `@${marketplaceName}`;
		if (!pluginKey.endsWith(suffix)) return false;
		return !keepPluginNames.has(pluginKey.slice(0, -suffix.length));
	});
}

export function ensureMarketplaceBlock(
	config: string,
	marketplaceName: string,
	source: CodexMarketplaceSource,
): string {
	const header = `marketplaces.${marketplaceName}`;
	const section = findTomlSection(config, header);
	if (section && marketplaceSourceMatches(section.text, source)) return config;
	const lines = [
		`[${header}]`,
		`last_updated = "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"`,
		`source_type = ${JSON.stringify(source.sourceType)}`,
		`source = ${JSON.stringify(source.source)}`,
	];
	if (source.sourceType === "git") {
		lines.push(`ref = ${JSON.stringify(source.ref)}`);
	}
	lines.push("");
	const block = lines.join("\n");
	if (section) {
		const trailingNewlines = section.text.match(/\n+$/)?.[0] ?? "\n";
		return (
			config.slice(0, section.start) +
			block.trimEnd() +
			trailingNewlines +
			config.slice(section.end)
		);
	}
	return appendBlock(config, block);
}

function marketplaceSourceMatches(
	sectionText: string,
	source: CodexMarketplaceSource,
): boolean {
	if (
		findTomlAssignment(sectionText, "source_type")?.value !==
		JSON.stringify(source.sourceType)
	)
		return false;
	if (
		findTomlAssignment(sectionText, "source")?.value !==
		JSON.stringify(source.source)
	)
		return false;
	const ref = findTomlAssignment(sectionText, "ref")?.value ?? null;
	return source.sourceType === "local"
		? ref === null
		: ref === JSON.stringify(source.ref);
}
