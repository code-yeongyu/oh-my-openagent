/**
 * Runtime migration for `[features.multi_agent_v2]`.
 *
 * Historical behavior (openai/codex#26753): force `enabled = false` on every
 * SessionStart because enabling V2 made every turn 400 with encrypted
 * spawn_agent parameters on models that were not configured for encrypted
 * tool use. OpenAI closed that as NOT_PLANNED (V2 under development).
 *
 * GPT-5.6 models that declare `multi_agent_version: "v2"` in the Codex model
 * catalog invert that failure mode: forcing `enabled = false` makes every
 * turn 400 with a reserved `collaboration.spawn_agent` schema mismatch
 * (lazycodex#118 / oh-my-openagent#6002 / openai/codex#31097), and
 * `hide_spawn_agent_metadata = false` (written by OMO installers <= 4.15.x)
 * mismatches the same reserved schema by re-adding agent_type/model
 * properties to spawn_agent. For those models this guard clears the managed
 * disable and the stale metadata override, leaving V2 unset so Codex can
 * follow model metadata.
 *
 * When the selected model is unknown or declares V1, keep the #26753
 * force-disable path.
 *
 * Opt out of the whole migration with LAZYCODEX_CONFIG_MIGRATION_DISABLED=1
 * (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import {
	findTomlSection as findSection,
	hasTomlSetting,
	removeTomlSectionSetting,
	removeRootTomlSetting,
	replaceOrInsertTomlSectionSetting,
	replaceOrInsertRootTomlSetting,
} from "./toml-section-editor.mjs";

const MANAGED_COMMENT_MARKER = "openai/codex#26753";
const MULTI_AGENT_V2_THREAD_LIMIT_KEY = "features.multi_agent_v2.max_concurrent_threads_per_session";
const MANAGED_DISABLE_COMMENT = [
	"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
	`# because enabling it fails every turn with HTTP 400 (${MANAGED_COMMENT_MARKER}).`,
	"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).",
	"",
].join("\n");

/**
 * @param {string} config
 * @param {{
 *   multiAgentVersion?: string | null,
 *   sessionModel?: string | null,
 *   requireSessionModel?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   modelsCachePath?: string,
 *   configPath?: string,
 * }} [options]
 */
export function forceDisableMultiAgentV2(config, options = {}) {
	// Always normalize the legacy `[features]` boolean shorthand first: leaving
	// `multi_agent_v2 = true|false` in place while a later guard appends the
	// `[features.multi_agent_v2]` table would define the same name as both a
	// scalar and a table, which Codex rejects as invalid TOML.
	const normalized = removeFeaturesShorthand(config);
	const sessionModel = normalizeModel(options.sessionModel);
	const multiAgentVersion =
		options.multiAgentVersion !== undefined
			? options.multiAgentVersion
			: resolveMultiAgentVersionFromConfig(normalized, options);
	const effectiveModel = sessionModel || readRootModel(normalized);

	if (prefersMultiAgentV2(multiAgentVersion, effectiveModel)) {
		return clearMultiAgentV2DisableForReservedSchema(normalized);
	}

	// SessionStart can run with an override model (`codex -m gpt-5.6-terra`) while
	// config.toml still lists a different default. If we cannot see the effective
	// session model, do not force-disable — writing enabled=false would break a
	// GPT-5.6 reserved collaboration.spawn_agent session.
	if (options.requireSessionModel === true && !sessionModel) {
		return normalized;
	}

	// No model evidence at all (no session model AND no root `model` in
	// config.toml — Codex Desktop selects the model in the UI): config alone
	// cannot prove the session is not a GPT-5.6 reserved-schema model, and
	// writing `enabled = false` would 400 every turn on those sessions
	// (#6002). Leave the enable state untouched.
	if (multiAgentVersion == null && !sessionModel && !readRootModel(normalized)) {
		return normalized;
	}

	// Unknown catalog entry for an explicit session model: skip force-disable
	// rather than assume the legacy encrypted-V2 failure mode.
	if (sessionModel && multiAgentVersion == null) {
		return normalized;
	}

	return forceDisableLegacyEncryptedV2(normalized);
}

/**
 * True when the effective model should run MultiAgentV2: the catalog says
 * "v2", or the catalog is unavailable but the model is a GPT-5.6 family
 * model (which reserves the collaboration.spawn_agent schema).
 * @param {"v1" | "v2" | null | undefined} multiAgentVersion
 * @param {string | null | undefined} sessionModel
 */
export function prefersMultiAgentV2(multiAgentVersion, sessionModel) {
	return multiAgentVersion === "v2" || (multiAgentVersion == null && isGpt56Family(normalizeModel(sessionModel)));
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
		modelsCachePath: options.modelsCachePath?.trim() || resolveModelCatalogPath(readRootModelCatalogPath(config), options) || undefined,
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
		join(options.env?.CODEX_HOME?.trim() || join(homedir(), ".codex"), "models_cache.json");

	try {
		const cache = JSON.parse(readFileSync(cachePath, "utf8"));
		const models = Array.isArray(cache?.models) ? cache.models : [];
		const entry = models.find((item) => item?.slug === model || item?.id === model);
		const version = entry?.multi_agent_version;
		if (version === "v1" || version === "v2") return version;
		return null;
	} catch {
		return null;
	}
}

export function readRootModel(config) {
	const double = config.match(/^\s*model\s*=\s*"([^"]+)"/m);
	if (double) return double[1];
	const single = config.match(/^\s*model\s*=\s*'([^']+)'/m);
	return single?.[1] ?? null;
}

// Codex documents `model_catalog_json` as a COMPLETE replacement for the
// fetched models_cache.json (codex-rs/core/src/config/mod.rs load_model_catalog
// -> load_catalog_json -> ModelsResponse). When set, Codex resolves the model
// only from that file, so the guard must too — otherwise Codex and the guard
// disagree on the multi-agent version (lazycodex#120).
export function readRootModelCatalogPath(config) {
	const double = config.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m);
	if (double) return double[1];
	const single = config.match(/^\s*model_catalog_json\s*=\s*'([^']+)'/m);
	return single?.[1] ?? null;
}

function resolveModelCatalogPath(configuredPath, options) {
	const trimmed = normalizeModel(configuredPath);
	if (!trimmed) return null;
	if (isAbsolute(trimmed)) return trimmed;
	const baseDir = options.configPath ? dirname(options.configPath) : options.env?.CODEX_HOME?.trim() || join(homedir(), ".codex");
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

function clearMultiAgentV2DisableForReservedSchema(config) {
	// `config` arrives shorthand-normalized from forceDisableMultiAgentV2.
	let result = removeManagedDisableComments(config);
	result = removeRootTomlSetting(result, "features.multi_agent_v2.enabled", "false");
	result = removeRootTomlSetting(result, "features.multi_agent_v2.hide_spawn_agent_metadata", "false");
	result = removeDottedMultiAgentV2Setting(result, "enabled", "false");
	result = removeDottedMultiAgentV2Setting(result, "hide_spawn_agent_metadata", "false");

	const section = findSection(result, "[features.multi_agent_v2]");
	if (!section) return result;

	// Two settings poison the reserved collaboration.spawn_agent schema on V2
	// models (verified against codex-cli 0.144.1 + gpt-5.6-sol):
	// - `enabled = false` forces the legacy V1 tool surface on some Codex
	//   versions (#6002's failure shape);
	// - `hide_spawn_agent_metadata = false` (written by OMO installers
	//   <= 4.15.x to expose agent_type) re-adds agent_type/model/... to
	//   spawn_agent, mismatching the reserved schema -> HTTP 400 every turn.
	// Remove both; `hide_spawn_agent_metadata = true` matches the Codex
	// default and is left alone.
	const cleared = section.text
		.replace(/^\s*enabled\s*=\s*false[ \t]*(?:#[^\n]*)?\n?/gm, "")
		.replace(/^\s*hide_spawn_agent_metadata\s*=\s*false[ \t]*(?:#[^\n]*)?\n?/gm, "");
	if (cleared === section.text) return result;
	return result.slice(0, section.start) + cleared + result.slice(section.end);
}

// `config` arrives shorthand-normalized from forceDisableMultiAgentV2.
function forceDisableLegacyEncryptedV2(config) {
	const section = findSection(config, "[features.multi_agent_v2]");

	if (!section) {
		if (hasTomlSetting(config, MULTI_AGENT_V2_THREAD_LIMIT_KEY)) {
			return setDottedMultiAgentV2Disable(config);
		}
		return ensureManagedComment(appendDisabledSection(config));
	}

	const enabledTruePattern = /^(\s*)enabled\s*=\s*true[ \t]*(#[^\n]*)?$/m;
	if (enabledTruePattern.test(section.text)) {
		const patched = section.text.replace(enabledTruePattern, (_match, indent, comment) =>
			comment ? `${indent}enabled = false ${comment}` : `${indent}enabled = false`,
		);
		return ensureManagedComment(config.slice(0, section.start) + patched + config.slice(section.end));
	}

	if (/^\s*enabled\s*=\s*false[ \t]*(?:#[^\n]*)?$/m.test(section.text)) return config;

	const headerEnd = section.text.indexOf("\n");
	const insertAt = headerEnd === -1 ? section.text.length : headerEnd + 1;
	const patched = `${section.text.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}enabled = false\n${section.text.slice(insertAt)}`;
	return ensureManagedComment(config.slice(0, section.start) + patched + config.slice(section.end));
}

function setDottedMultiAgentV2Disable(config) {
	const featuresSection = findSection(config, "[features]");
	if (!featuresSection) {
		return replaceOrInsertRootTomlSetting(config, "features.multi_agent_v2.enabled", "false");
	}
	return replaceOrInsertTomlSectionSetting(config, featuresSection, "multi_agent_v2.enabled", "false");
}

function removeDottedMultiAgentV2Setting(config, key, expectedValue) {
	const featuresSection = findSection(config, "[features]");
	if (!featuresSection) return config;
	return removeTomlSectionSetting(config, featuresSection, `multi_agent_v2.${key}`, expectedValue);
}

function ensureManagedComment(config) {
	if (config.includes(MANAGED_COMMENT_MARKER)) return config;
	const section = findSection(config, "[features.multi_agent_v2]");
	if (!section) return config;
	return config.slice(0, section.start) + MANAGED_DISABLE_COMMENT + config.slice(section.start);
}

function removeManagedDisableComments(config) {
	if (!config.includes(MANAGED_COMMENT_MARKER) && !config.includes("Managed by LazyCodex: multi_agent_v2")) {
		return config;
	}

	const lines = config.split("\n");
	const kept = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (
			trimmed.startsWith("#") &&
			(trimmed.includes(MANAGED_COMMENT_MARKER) ||
				trimmed.includes("Managed by LazyCodex: multi_agent_v2") ||
				trimmed.includes("because enabling it fails every turn with HTTP 400") ||
				trimmed.includes("LAZYCODEX_CONFIG_MIGRATION_DISABLED=1") ||
				trimmed.includes("OMO_CODEX_CONFIG_MIGRATION_DISABLED=1"))
		) {
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function removeFeaturesShorthand(config) {
	const section = findSection(config, "[features]");
	if (!section) return config;

	const shorthandPattern = /^\s*multi_agent_v2\s*=\s*(?:true|false)[ \t]*(?:#[^\n]*)?[ \t]*\n?/m;
	if (!shorthandPattern.test(section.text)) return config;

	const patched = section.text.replace(shorthandPattern, "");
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function appendDisabledSection(config) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}[features.multi_agent_v2]\nenabled = false\n`;
}
