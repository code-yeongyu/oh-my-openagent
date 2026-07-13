import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { scanTomlLines } from "./toml-lexical-lines.mjs";

/**
 * True when the effective model should run MultiAgentV2: the catalog says
 * "v2", or the catalog is unavailable but the model is a GPT-5.6 family
 * model (which reserves the collaboration.spawn_agent schema).
 * @param {"v1" | "v2" | null | undefined} multiAgentVersion
 * @param {string | null | undefined} sessionModel
 */
export function prefersMultiAgentV2(multiAgentVersion, sessionModel) {
	return (
		multiAgentVersion === "v2" ||
		(multiAgentVersion == null && isGpt56Family(normalizeModel(sessionModel)))
	);
}

/**
 * Resolve the effective model against Codex `models_cache.json`.
 * Prefers SessionStart `model` over the root `model` in config.toml.
 * @param {string} config
 * @param {{ sessionModel?: string | null, env?: NodeJS.ProcessEnv, modelsCachePath?: string, configPath?: string }} [options]
 * @returns {"v1" | "v2" | null}
 */
export function resolveMultiAgentVersionFromConfig(config, options = {}) {
	const model = normalizeModel(options.sessionModel) || readRootModel(config);
	if (!model) return null;
	const version = resolveMultiAgentVersionForModel(model, {
		...options,
		modelsCachePath:
			options.modelsCachePath?.trim() ||
			resolveModelCatalogPath(readRootModelCatalogPath(config), options) ||
			undefined,
	});
	return version ?? (isGpt56Family(model) ? "v2" : null);
}

/**
 * @param {string} model
 * @param {{ env?: NodeJS.ProcessEnv, modelsCachePath?: string }} [options]
 * @returns {"v1" | "v2" | null}
 */
export function resolveMultiAgentVersionForModel(model, options = {}) {
	const cachePath =
		options.modelsCachePath?.trim() ||
		join(
			options.env?.CODEX_HOME?.trim() || join(homedir(), ".codex"),
			"models_cache.json",
		);

	try {
		const cache = JSON.parse(readFileSync(cachePath, "utf8"));
		const models = Array.isArray(cache?.models) ? cache.models : [];
		const entry = models.find(
			(item) => item?.slug === model || item?.id === model,
		);
		const version = entry?.multi_agent_version;
		if (version === "v1" || version === "v2") return version;
		return null;
	} catch {
		return null;
	}
}

export function readRootModel(config) {
	return readRootStringSetting(config, "model");
}

// Codex treats `model_catalog_json` as a complete replacement for the fetched
// model catalog, so the guard must resolve the same root-level path Codex uses.
export function readRootModelCatalogPath(config) {
	return readRootStringSetting(config, "model_catalog_json");
}

function readRootStringSetting(config, key) {
	for (const line of scanTomlLines(config)) {
		if (line.tableHeader !== null) break;
		if (line.assignment?.key !== key) continue;
		return parseTomlString(line.assignment.value);
	}
	return null;
}

function parseTomlString(value) {
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === "string" ? parsed : null;
	} catch {
		return null;
	}
}

function resolveModelCatalogPath(configuredPath, options) {
	const trimmed = normalizeModel(configuredPath);
	if (!trimmed) return null;
	if (isAbsolute(trimmed)) return trimmed;
	const baseDir = options.configPath
		? dirname(options.configPath)
		: options.env?.CODEX_HOME?.trim() || join(homedir(), ".codex");
	return join(baseDir, trimmed);
}

function normalizeModel(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isGpt56Family(model) {
	return typeof model === "string" && /^gpt-5\.6\b/i.test(model);
}
