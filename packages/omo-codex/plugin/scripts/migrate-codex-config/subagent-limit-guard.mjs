import { prefersMultiAgentV2, resolveMultiAgentVersionFromConfig } from "./multi-agent-v2-guard.mjs";
import { findTomlSection as findSection, removeTomlSectionSetting } from "./toml-section-editor.mjs";

const CODEX_AGENTS_HEADER = "[agents]";
const CODEX_MULTI_AGENT_V2_HEADER = "[features.multi_agent_v2]";

/**
 * Ensure subagent concurrency limits without writing settings that conflict
 * with MultiAgentV2. When the selected model prefers V2 (catalog `v2`, or a
 * GPT-5.6 or GPT-6 family session model with the catalog unavailable) or V2 is already
 * enabled in config, skip `agents.max_threads` because Codex rejects that key
 * while features.multi_agent_v2 is enabled.
 *
 * Never insert or raise either cap. Remove LazyCodex-written values and
 * preserve other user values, except for the incompatible V1 key under V2.
 *
 * @param {string} config
 * @param {{ multiAgentVersion?: string | null, sessionModel?: string | null, env?: NodeJS.ProcessEnv, modelsCachePath?: string }} [options]
 */
export function ensureSubagentConcurrencyLimit(config, options = {}) {
	const version = options.multiAgentVersion !== undefined
		? options.multiAgentVersion
		: resolveMultiAgentVersionFromConfig(config, options);
	// Keep this V2-active rule aligned with src/install/codex-multi-agent-v2-config.ts.
	const v2Section = findSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	const v2Preferred = prefersMultiAgentV2(version, options.sessionModel)
		|| (v2Section !== null && /^\s*enabled\s*=\s*true[ \t]*(?:#[^\n]*)?$/m.test(v2Section.text));
	return removeManagedV2ThreadLimit(removeAgentsMaxThreads(config, v2Preferred));
}

function removeAgentsMaxThreads(config, v2Preferred) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return config;
	return removeTomlSectionSetting(config, section, "max_threads", v2Preferred ? undefined : "1000");
}

function removeManagedV2ThreadLimit(config) {
	const section = findSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return config;
	const withoutLegacyCap = removeTomlSectionSetting(config, section, "max_concurrent_threads_per_session", "1000");
	return removeTomlSectionSetting(withoutLegacyCap, findSection(withoutLegacyCap, CODEX_MULTI_AGENT_V2_HEADER), "max_concurrent_threads_per_session", "16");
}
