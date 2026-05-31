import { appendBlock, findTomlSection, removeSetting, replaceOrInsertSetting } from "./toml-editor.mjs";

const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2";
const CODEX_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION = 10000;

export function ensureCodexMultiAgentV2Config(config) {
	const normalizedConfig = removeLegacyAgentsMaxThreadsSetting(removeFeatureFlagSetting(config, "multi_agent_v2"));
	const section = findTomlSection(normalizedConfig, CODEX_MULTI_AGENT_V2_HEADER);
	const maxThreadsValue = CODEX_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION.toString();
	if (!section) {
		return appendBlock(
			normalizedConfig,
			`[${CODEX_MULTI_AGENT_V2_HEADER}]\nenabled = true\nmax_concurrent_threads_per_session = ${maxThreadsValue}\n`,
		);
	}

	const enabledConfig = replaceOrInsertSetting(normalizedConfig, section, "enabled", "true");
	const updatedSection = findTomlSection(enabledConfig, CODEX_MULTI_AGENT_V2_HEADER);
	if (!updatedSection) {
		return appendBlock(
			enabledConfig,
			`[${CODEX_MULTI_AGENT_V2_HEADER}]\nenabled = true\nmax_concurrent_threads_per_session = ${maxThreadsValue}\n`,
		);
	}
	return replaceOrInsertSetting(enabledConfig, updatedSection, "max_concurrent_threads_per_session", maxThreadsValue);
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
