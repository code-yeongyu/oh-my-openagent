import {
	type CodexMultiAgentVersion,
	readRootModel,
} from "./codex-multi-agent-v2-model-resolution";
import { findTomlAssignment, isTomlLexicallyValid } from "./toml-lexical-lines";
import {
	appendBlock,
	findTomlSection,
	removeSetting,
	replaceOrInsertSetting,
} from "./toml-section-editor";

const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2";
const CODEX_SUBAGENT_THREAD_LIMIT = 1000;
const CODEX_MULTI_AGENT_V2_TOOL_NAMESPACE = "agents";
const MANAGED_MULTI_AGENT_V2_COMMENT =
	"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start";
const CODEX_MULTI_AGENT_MODE_HINT =
	"Work directly on trivial or bounded tasks. Delegate only when specialization, meaningful parallelism, unresolved complexity, or an explicit plan materially improves the result. Do not delegate merely because agents are available. Preserve focused delegation for genuinely heavy work.";

export type { CodexMultiAgentVersion } from "./codex-multi-agent-v2-model-resolution";
export { resolveCodexMultiAgentVersion } from "./codex-multi-agent-v2-model-resolution";

/**
 * Configure Codex subagent thread limits without forcing multi_agent_v2 on.
 *
 * Whether V2 is active is determined at runtime by the model's server-side
 * catalog entry (`ModelInfo.multi_agent_version`).  Forcing `enabled = true`
 * in config breaks models whose API does not support encrypted tool
 * parameters (e.g. gpt-5.5-medium, API-key-only models, third-party
 * providers). The installer therefore configures only V2 routing settings and
 * preserves user-authored concurrency settings regardless of active runtime.
 *
 * When the selected model prefers V2 (catalog `multi_agent_version: "v2"`,
 * or a GPT-5.6 family model with the catalog unavailable), the installer
 * does not materialize `enabled = false` from
 * the legacy `[features]` boolean shorthand (a config-level disable
 * mismatches the reserved `collaboration.spawn_agent` schema on some Codex
 * versions - oh-my-openagent#6002 / #6008).
 *
 * When config.toml names no root model at all (Codex Desktop selects the
 * model in the UI), the installer never introduces `agents.max_threads`:
 * Codex rejects that key at thread/start while MultiAgentV2 is active. An
 * existing cap stays unchanged and a hand-removed key stays removed. The namespace/metadata pair
 * remains configured so an inherited V2 model exposes the typed spawn fields.
 */
export function ensureCodexMultiAgentV2Config(
	config: string,
	options: { readonly multiAgentVersion?: CodexMultiAgentVersion } = {},
): string {
	if (!isTomlLexicallyValid(config)) return config;
	const removeManagedMultiAgentV2ThreadLimit =
		hasManagedMultiAgentV2ThreadLimit(config);
	const featureFlag = removeFeatureFlagSetting(config, "multi_agent_v2");
	const v2Preferred = options.multiAgentVersion === "v2";
	const modelKnown =
		options.multiAgentVersion != null ||
		readRootModel(featureFlag.config) !== null;
	const agentsConfig = featureFlag.config;
	const preserveDisable = featureFlag.value === false && !v2Preferred;
	const featureConfig = preserveDisable
		? ensureMultiAgentV2Disable(agentsConfig)
		: v2Preferred
			? removeMultiAgentV2Disable(agentsConfig)
			: agentsConfig;
	const routedConfig =
		v2Preferred || !modelKnown
			? ensureMultiAgentV2PreferredSettings(featureConfig)
			: ensureMultiAgentV2Section(featureConfig);
	return removeManagedMultiAgentV2ThreadLimit
		? removeMultiAgentV2ThreadLimit(routedConfig)
		: routedConfig;
}

function removeFeatureFlagSetting(
	config: string,
	featureName: string,
): {
	readonly config: string;
	readonly value: boolean | null;
} {
	const section = findTomlSection(config, "features");
	if (!section) return { config, value: null };
	return {
		config: removeSetting(config, section, featureName),
		value: readBooleanSetting(section.text, featureName),
	};
}

function removeMultiAgentV2Disable(config: string): string {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return config;
	if (findTomlAssignment(section.text, "enabled")?.value !== "false")
		return config;
	return removeSetting(config, section, "enabled");
}

function ensureMultiAgentV2PreferredSettings(config: string): string {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) {
		return appendBlock(
			config,
			[
				`[${CODEX_MULTI_AGENT_V2_HEADER}]`,
				`tool_namespace = ${JSON.stringify(CODEX_MULTI_AGENT_V2_TOOL_NAMESPACE)}`,
				"hide_spawn_agent_metadata = false",
				`multi_agent_mode_hint_text = ${JSON.stringify(CODEX_MULTI_AGENT_MODE_HINT)}`,
				"",
			].join("\n"),
		);
	}
	let result = config;
	result = ensureMultiAgentV2Hint(result);
	result = replaceOrInsertMultiAgentV2Setting(
		result,
		"hide_spawn_agent_metadata",
		"false",
	);
	return replaceOrInsertMultiAgentV2Setting(
		result,
		"tool_namespace",
		JSON.stringify(CODEX_MULTI_AGENT_V2_TOOL_NAMESPACE),
	);
}

function ensureMultiAgentV2Hint(config: string): string {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return config;
	if (hasSetting(section.text, "multi_agent_mode_hint_text")) return config;
	return replaceOrInsertSetting(
		config,
		section,
		"multi_agent_mode_hint_text",
		JSON.stringify(CODEX_MULTI_AGENT_MODE_HINT),
	);
}

function replaceOrInsertMultiAgentV2Setting(
	config: string,
	key: string,
	value: string,
): string {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return config;
	return replaceOrInsertSetting(config, section, key, value);
}

function ensureMultiAgentV2Disable(config: string): string {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) {
		return appendBlock(
			config,
			`[${CODEX_MULTI_AGENT_V2_HEADER}]\nenabled = false\n`,
		);
	}
	return replaceOrInsertSetting(config, section, "enabled", "false");
}

function hasManagedMultiAgentV2ThreadLimit(config: string): boolean {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return false;
	if (
		!settingEquals(
			section.text,
			"max_concurrent_threads_per_session",
			CODEX_SUBAGENT_THREAD_LIMIT.toString(),
		)
	) {
		return false;
	}
	return hasAdjacentManagedComment(config, section.start);
}

function removeMultiAgentV2ThreadLimit(config: string): string {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return config;
	return removeSetting(config, section, "max_concurrent_threads_per_session");
}

function ensureMultiAgentV2Section(config: string): string {
	return findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER)
		? config
		: appendBlock(config, `[${CODEX_MULTI_AGENT_V2_HEADER}]\n`);
}

function settingEquals(
	sectionText: string,
	key: string,
	value: string,
): boolean {
	return findTomlAssignment(sectionText, key)?.value === value;
}

function readBooleanSetting(sectionText: string, key: string): boolean | null {
	const value = findTomlAssignment(sectionText, key)?.value;
	return value === "true" ? true : value === "false" ? false : null;
}

function hasSetting(sectionText: string, key: string): boolean {
	return findTomlAssignment(sectionText, key) !== null;
}

function hasAdjacentManagedComment(
	config: string,
	sectionStart: number,
): boolean {
	const lines = config.slice(0, sectionStart).split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	let blankLines = 0;
	while (lines.length > 0) {
		const line = lines.pop()?.trim();
		if (line === "" && blankLines === 0) {
			blankLines += 1;
			continue;
		}
		if (line === MANAGED_MULTI_AGENT_V2_COMMENT) return true;
		if (!line?.startsWith("#")) return false;
	}
	return false;
}
