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
 * (lazycodex#118 / oh-my-openagent#6002 / openai/codex#31097). For those
 * models this guard clears the managed disable and leaves V2 unset so Codex
 * can follow model metadata.
 *
 * When the selected model is unknown or declares V1, keep the #26753
 * force-disable path.
 *
 * Opt out of the whole migration with LAZYCODEX_CONFIG_MIGRATION_DISABLED=1
 * (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MANAGED_COMMENT_MARKER = "openai/codex#26753";
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
 * }} [options]
 */
export function forceDisableMultiAgentV2(config, options = {}) {
	const sessionModel = normalizeModel(options.sessionModel);
	const multiAgentVersion =
		options.multiAgentVersion !== undefined
			? options.multiAgentVersion
			: resolveMultiAgentVersionFromConfig(config, options);

	if (multiAgentVersion === "v2" || (multiAgentVersion == null && isGpt56Family(sessionModel))) {
		return clearMultiAgentV2DisableForReservedSchema(config);
	}

	// SessionStart can run with an override model (`codex -m gpt-5.6-terra`) while
	// config.toml still lists a different default. If we cannot see the effective
	// session model, do not force-disable — writing enabled=false would break a
	// GPT-5.6 reserved collaboration.spawn_agent session.
	if (options.requireSessionModel === true && !sessionModel) {
		return config;
	}

	// Unknown catalog entry for an explicit session model: skip force-disable
	// rather than assume the legacy encrypted-V2 failure mode.
	if (sessionModel && multiAgentVersion == null) {
		return config;
	}

	return forceDisableLegacyEncryptedV2(config);
}

/**
 * Resolve the effective model against Codex `models_cache.json`.
 * Prefers SessionStart `model` over the root `model` in config.toml.
 * @param {string} config
 * @param {{ sessionModel?: string | null, env?: NodeJS.ProcessEnv, modelsCachePath?: string }} [options]
 * @returns {"v1" | "v2" | null}
 */
export function resolveMultiAgentVersionFromConfig(config, options = {}) {
	const model = normalizeModel(options.sessionModel) || readRootModel(config);
	if (!model) return null;
	return resolveMultiAgentVersionForModel(model, options);
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

function normalizeModel(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isGpt56Family(model) {
	return typeof model === "string" && /^gpt-5\.6\b/i.test(model);
}

function clearMultiAgentV2DisableForReservedSchema(config) {
	let result = removeFeaturesShorthand(config);
	result = removeManagedDisableComments(result);

	const section = findSection(result, "[features.multi_agent_v2]");
	if (!section) return result;

	const withoutEnabledFalse = section.text.replace(/^\s*enabled\s*=\s*false[ \t]*(?:#[^\n]*)?\n?/gm, "");
	if (withoutEnabledFalse === section.text) return result;
	return result.slice(0, section.start) + withoutEnabledFalse + result.slice(section.end);
}

function forceDisableLegacyEncryptedV2(config) {
	let result = removeFeaturesShorthand(config);
	const section = findSection(result, "[features.multi_agent_v2]");

	if (!section) {
		return ensureManagedComment(appendDisabledSection(result));
	}

	const enabledTruePattern = /^(\s*)enabled\s*=\s*true[ \t]*(#[^\n]*)?$/m;
	if (enabledTruePattern.test(section.text)) {
		const patched = section.text.replace(enabledTruePattern, (_match, indent, comment) =>
			comment ? `${indent}enabled = false ${comment}` : `${indent}enabled = false`,
		);
		return ensureManagedComment(result.slice(0, section.start) + patched + result.slice(section.end));
	}

	if (/^\s*enabled\s*=\s*false[ \t]*(?:#[^\n]*)?$/m.test(section.text)) return result;

	const headerEnd = section.text.indexOf("\n");
	const insertAt = headerEnd === -1 ? section.text.length : headerEnd + 1;
	const patched = `${section.text.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}enabled = false\n${section.text.slice(insertAt)}`;
	return ensureManagedComment(result.slice(0, section.start) + patched + result.slice(section.end));
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

// Strips a trailing # comment from a TOML line fragment (best-effort; quoted keys containing # are out of scope).
function stripTrailingComment(line) {
	const idx = line.indexOf("#");
	return idx === -1 ? line : line.slice(0, idx).trim();
}

function findSection(config, headerLine) {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let start = -1;
	for (const line of lines) {
		if (line.length === 0) break;
		const trimmed = line.trim();
		if (start === -1) {
			if (stripTrailingComment(trimmed) === headerLine) start = offset;
		} else {
			const bare = stripTrailingComment(trimmed);
			if (bare.startsWith("[") && bare.endsWith("]")) {
				return { start, end: offset, text: config.slice(start, offset) };
			}
		}
		offset += line.length;
	}
	if (start === -1) return null;
	return { start, end: config.length, text: config.slice(start) };
}
