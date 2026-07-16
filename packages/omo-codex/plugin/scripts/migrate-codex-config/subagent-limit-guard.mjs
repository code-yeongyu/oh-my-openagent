import { prefersMultiAgentV2, readRootModel, resolveMultiAgentVersionFromConfig } from "./multi-agent-v2-guard.mjs";
import {
	findTomlSection as findSection,
	hasTomlSetting,
	replaceOrInsertTomlSectionSetting,
} from "./toml-section-editor.mjs";

const CODEX_AGENTS_HEADER = "[agents]";
const CODEX_MULTI_AGENT_V2_HEADER = "[features.multi_agent_v2]";
const CODEX_MULTI_AGENT_V2_THREAD_LIMIT_KEY = "features.multi_agent_v2.max_concurrent_threads_per_session";
const CODEX_SUBAGENT_THREAD_LIMIT = "1000";
const CODEX_MULTI_AGENT_V2_DEFAULT_THREAD_LIMIT = "16";

/**
 * Ensure subagent concurrency limits without writing settings that conflict
 * with MultiAgentV2. When the selected model prefers V2 (catalog `v2`, or a
 * GPT-5.6 family session model with the catalog unavailable) or V2 is already
 * enabled in config, skip `agents.max_threads` because Codex rejects that key
 * while features.multi_agent_v2 is enabled.
 *
 * When no model is resolvable at all (no session model and no root `model`
 * in config.toml — Codex Desktop selects the model in the UI), never
 * introduce `agents.max_threads`: it hard-fails thread/start on
 * MultiAgentV2 sessions. An existing cap is still raised in place so the
 * legacy low-cap repair keeps working and a hand-removed key stays removed.
 *
 * @param {string} config
 * @param {{ multiAgentVersion?: string | null, sessionModel?: string | null, env?: NodeJS.ProcessEnv, modelsCachePath?: string }} [options]
 */
export function ensureSubagentConcurrencyLimit(config, options = {}) {
	const multiAgentVersion =
		options.multiAgentVersion !== undefined
			? options.multiAgentVersion
			: resolveMultiAgentVersionFromConfig(config, options);
	const v2Preferred = prefersMultiAgentV2(multiAgentVersion, options.sessionModel) || isMultiAgentV2Enabled(config);

	let result = config;
	if (v2Preferred) {
		result = removeAgentsMaxThreads(result);
	} else if (multiAgentVersion == null && !hasModelEvidence(config, options)) {
		result = raiseExistingAgentsMaxThreads(result);
	} else {
		result = ensureAgentsMaxThreads(result);
	}
	return ensureMultiAgentV2ThreadLimit(result);
}

function hasModelEvidence(config, options) {
	const sessionModel = typeof options.sessionModel === "string" ? options.sessionModel.trim() : "";
	return sessionModel.length > 0 || readRootModel(config) !== null;
}

function isMultiAgentV2Enabled(config) {
	const section = findSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return false;
	return /^\s*enabled\s*=\s*true[ \t]*(?:#[^\n]*)?$/m.test(section.text);
}

function raiseExistingAgentsMaxThreads(config) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return config;
	if (!/^\s*max_threads\s*=/m.test(section.text)) return config;
	return replaceOrInsertTomlSectionSetting(config, section, "max_threads", CODEX_SUBAGENT_THREAD_LIMIT);
}

function ensureAgentsMaxThreads(config) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return appendBlock(config, `${CODEX_AGENTS_HEADER}\nmax_threads = ${CODEX_SUBAGENT_THREAD_LIMIT}\n`);
	return replaceOrInsertTomlSectionSetting(config, section, "max_threads", CODEX_SUBAGENT_THREAD_LIMIT);
}

function removeAgentsMaxThreads(config) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return config;
	if (!/^\s*max_threads\s*=/m.test(section.text)) return config;

	const patched = section.text.replace(/^\s*max_threads\s*=\s*[^\n]*\n?/m, "");
	const bodyLines = patched
		.split("\n")
		.slice(1)
		.filter((line) => line.trim() !== "");
	if (bodyLines.length === 0) {
		return config.slice(0, section.start) + config.slice(section.end).replace(/^\n+/, "");
	}
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function ensureMultiAgentV2ThreadLimit(config) {
	if (hasTomlSetting(config, CODEX_MULTI_AGENT_V2_THREAD_LIMIT_KEY)) return config;
	const section = findSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) {
		return appendBlock(
			config,
			`${CODEX_MULTI_AGENT_V2_HEADER}\nmax_concurrent_threads_per_session = ${CODEX_MULTI_AGENT_V2_DEFAULT_THREAD_LIMIT}\n`,
		);
	}
	return replaceOrInsertTomlSectionSetting(
		config,
		section,
		"max_concurrent_threads_per_session",
		CODEX_MULTI_AGENT_V2_DEFAULT_THREAD_LIMIT,
	);
}

function appendBlock(config, block) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}${block}`;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
