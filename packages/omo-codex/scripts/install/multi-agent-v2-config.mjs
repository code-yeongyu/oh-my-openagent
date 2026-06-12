import { appendBlock, findTomlSection, removeSetting, replaceOrInsertSetting } from "./toml-editor.mjs";

const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2";
const CODEX_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION = 10000;

/**
 * Configure multi_agent_v2 thread limits without forcing the feature on.
 *
 * Whether V2 is active is determined at runtime by the model's server-side
 * catalog entry (ModelInfo.multi_agent_version).  Forcing enabled = true
 * in config breaks models whose API does not support encrypted tool
 * parameters.  The installer therefore only sets the tuning knob
 * (max_concurrent_threads_per_session) so that sessions that DO activate
 * V2 benefit from the higher limit.
 */
export function ensureCodexMultiAgentV2Config(config) {
	const normalizedConfig = removeLegacyAgentsMaxThreadsSetting(removeFeatureFlagSetting(config, "multi_agent_v2"));
	const section = findTomlSection(normalizedConfig, CODEX_MULTI_AGENT_V2_HEADER);
	const maxThreadsValue = CODEX_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION.toString();
	if (!section) {
		return appendBlock(
			normalizedConfig,
			`[${CODEX_MULTI_AGENT_V2_HEADER}]\nmax_concurrent_threads_per_session = ${maxThreadsValue}\nhide_spawn_agent_metadata = false\n`,
		);
	}

	// Codex defaults hide_spawn_agent_metadata to true on V2, which strips the
	// agent_type parameter from spawn_agent and makes the role TOMLs this
	// installer ships unselectable.
	const withMaxThreads = replaceOrInsertSetting(
		normalizedConfig,
		section,
		"max_concurrent_threads_per_session",
		maxThreadsValue,
	);
	const updatedSection = findTomlSection(withMaxThreads, CODEX_MULTI_AGENT_V2_HEADER);
	return replaceOrInsertSetting(withMaxThreads, updatedSection, "hide_spawn_agent_metadata", "false");
}

function removeFeatureFlagSetting(config, featureName) {
	const section = findTomlSection(config, "features");
	if (!section) return config;
	return removeSetting(config, section, featureName);
}

function removeLegacyAgentsMaxThreadsSetting(config) {
	const section = findTomlSection(config, "agents");
	if (!section) return config;
	return removeSetting(config, section, "max_threads");
}
