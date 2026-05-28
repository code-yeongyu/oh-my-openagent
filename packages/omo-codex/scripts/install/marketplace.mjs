import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "./utils.mjs";

const DEFAULT_MARKETPLACE_PATH = "packages/omo-codex/marketplace.json";

export async function readMarketplace(repoRoot, options = {}) {
	const marketplacePath = options.marketplacePath ?? join(repoRoot, DEFAULT_MARKETPLACE_PATH);
	const raw = await readFile(marketplacePath, "utf8");
	const parsed = JSON.parse(raw);
	if (!isRecord(parsed)) throw new Error("marketplace.json must be an object");
	if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
		throw new Error("marketplace.json name must be a non-empty string");
	}
	validatePathSegment(parsed.name, "marketplace name");
	if (!Array.isArray(parsed.plugins)) throw new Error("marketplace.json plugins must be an array");

	return {
		name: parsed.name,
		plugins: parsed.plugins.map((plugin, index) => normalizeMarketplacePlugin(plugin, index)),
	};
}

export function resolvePluginSource(marketplaceRoot, plugin, options = {}) {
	const sourcePath = localSourcePath(options.pathOverride ?? plugin.source);
	const relativePath = sourcePath.slice(2);
	return join(marketplaceRoot, ...relativePath.split(/[\\/]/));
}

export async function readPluginManifest(pluginRoot) {
	const raw = await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8");
	const parsed = JSON.parse(raw);
	if (!isRecord(parsed)) throw new Error(`${pluginRoot} plugin.json must be an object`);
	if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
		throw new Error(`${pluginRoot} plugin.json name must be a non-empty string`);
	}
	const manifest = { name: parsed.name };
	if (parsed.version !== undefined) {
		if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
			throw new Error(`${pluginRoot} plugin.json version must be a non-empty string`);
		}
		manifest.version = parsed.version.trim();
	}
	return manifest;
}

export function validatePathSegment(value, label) {
	if (!/^[A-Za-z0-9._+-]+$/.test(value)) {
		throw new Error(`${label} contains unsupported characters: ${value}`);
	}
	if (value === "." || value === "..") {
		throw new Error(`${label} must not be a path traversal segment`);
	}
}

function normalizeMarketplacePlugin(plugin, index) {
	if (!isRecord(plugin)) throw new Error(`marketplace plugin ${index} must be an object`);
	if (typeof plugin.name !== "string" || plugin.name.trim() === "") {
		throw new Error(`marketplace plugin ${index} name must be a non-empty string`);
	}
	validatePathSegment(plugin.name, "plugin name");
	if (plugin.source === undefined || typeof plugin.source === "string") {
		if (typeof plugin.source === "string") validateLocalSourcePath(plugin.source);
		return {
			name: plugin.name,
			source: plugin.source,
		};
	}
	if (isRecord(plugin.source) && plugin.source.source === "local" && typeof plugin.source.path === "string") {
		validateLocalSourcePath(plugin.source.path);
		return {
			name: plugin.name,
			source: { source: "local", path: plugin.source.path },
		};
	}
	throw new Error("local plugin source must be a string path or { source: \"local\", path } object");
}

function localSourcePath(source) {
	if (typeof source === "string") return validateLocalSourcePath(source);
	if (
		isRecord(source) &&
		source.source === "local" &&
		typeof source.path === "string"
	) {
		return validateLocalSourcePath(source.path);
	}
	throw new Error("local plugin source must be a string path or { source: \"local\", path } object");
}

function validateLocalSourcePath(path) {
	if (!path.startsWith("./")) {
		throw new Error("local plugin source path must start with ./");
	}
	const relative = path.slice(2);
	if (relative.length === 0) throw new Error("local plugin source path must not be empty");
	for (const part of relative.split(/[\\/]/)) {
		if (part === "" || part === "." || part === "..") {
			throw new Error("local plugin source path must stay within the marketplace root");
		}
	}
	return path;
}
