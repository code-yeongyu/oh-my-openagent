import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { scanTomlLines } from "./toml-lexical-lines";

export type CodexMultiAgentVersion = "v1" | "v2" | null;

/**
 * Resolve the configured root model's multi-agent version from the Codex
 * model catalog cache (`models_cache.json` next to `config.toml`).
 * Mirrors `plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`:
 * catalog wins; a GPT-5.6 family model with no catalog entry counts as V2.
 */
export function resolveCodexMultiAgentVersion(
	config: string,
	configPath: string,
): CodexMultiAgentVersion {
	const model = readRootModel(config);
	if (model === null) return null;
	const catalogPath = resolveCatalogPath(
		readRootModelCatalogPath(config),
		configPath,
	);
	const catalogVersion = readCatalogMultiAgentVersion(model, catalogPath);
	if (catalogVersion !== null) return catalogVersion;
	return /^gpt-5\.6\b/i.test(model) ? "v2" : null;
}

export function readRootModel(config: string): string | null {
	return readRootStringSetting(config, "model");
}

function resolveCatalogPath(
	configuredPath: string | null,
	configPath: string,
): string {
	if (configuredPath === null)
		return join(dirname(configPath), "models_cache.json");
	return isAbsolute(configuredPath)
		? configuredPath
		: join(dirname(configPath), configuredPath);
}

function readCatalogMultiAgentVersion(
	model: string,
	cachePath: string,
): CodexMultiAgentVersion {
	let raw: string;
	try {
		raw = readFileSync(cachePath, "utf8");
	} catch {
		return null;
	}
	let cache: unknown;
	try {
		cache = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(cache) || !Array.isArray(cache.models)) return null;
	for (const entry of cache.models) {
		if (!isRecord(entry)) continue;
		if (entry.slug !== model && entry.id !== model) continue;
		const version = entry.multi_agent_version;
		if (version === "v1" || version === "v2") return version;
		return null;
	}
	return null;
}

function readRootModelCatalogPath(config: string): string | null {
	return readRootStringSetting(config, "model_catalog_json");
}

function readRootStringSetting(config: string, key: string): string | null {
	for (const line of scanTomlLines(config)) {
		if (line.tableHeader !== null) break;
		if (line.assignment?.key !== key) continue;
		return parseTomlString(line.assignment.value);
	}
	return null;
}

function parseTomlString(value: string): string | null {
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "string" ? parsed : null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
