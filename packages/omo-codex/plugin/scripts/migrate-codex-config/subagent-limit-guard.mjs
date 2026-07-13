import {
	findTomlAssignment,
	findTomlSection,
	isTomlLexicallyValid,
} from "./toml-lexical-lines.mjs";

const CODEX_MULTI_AGENT_V2_HEADER = "[features.multi_agent_v2]";
const CODEX_SUBAGENT_THREAD_LIMIT = "1000";
const MANAGED_MULTI_AGENT_V2_COMMENT =
	"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start";

/**
 * Preserve user concurrency choices. The only mutation here is removal of the
 * exact historical V2 `1000` when the immediately adjacent LazyCodex comment
 * proves ownership; absent settings and legacy `[agents].max_threads` stay as-is.
 */
export function ensureSubagentConcurrencyLimit(config, options = {}) {
	if (!isTomlLexicallyValid(config)) return config;
	const result = ensureMultiAgentV2Section(config);
	return options.removeManagedMultiAgentV2ThreadLimit === true
		? removeMultiAgentV2ThreadLimit(result)
		: result;
}

export function hasManagedMultiAgentV2ThreadLimit(config) {
	if (!isTomlLexicallyValid(config)) return false;
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return false;
	if (
		findTomlAssignment(section.text, "max_concurrent_threads_per_session")
			?.value !== CODEX_SUBAGENT_THREAD_LIMIT
	) {
		return false;
	}
	return hasAdjacentManagedComment(config, section.start);
}

function removeMultiAgentV2ThreadLimit(config) {
	const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) return config;
	const assignment = findTomlAssignment(
		section.text,
		"max_concurrent_threads_per_session",
	);
	if (assignment?.value !== CODEX_SUBAGENT_THREAD_LIMIT) return config;
	const patched =
		section.text.slice(0, assignment.start) +
		section.text.slice(assignment.end + assignment.newline.length);
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function ensureMultiAgentV2Section(config) {
	if (findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER)) return config;
	const trimmed = config.trimEnd();
	return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${CODEX_MULTI_AGENT_V2_HEADER}\n`;
}

function hasAdjacentManagedComment(config, sectionStart) {
	let cursor = sectionStart;
	let blankLines = 0;
	while (cursor > 0) {
		const lineEnd = config[cursor - 1] === "\n" ? cursor - 1 : cursor;
		const lineStart = config.lastIndexOf("\n", lineEnd - 1) + 1;
		const line = config.slice(lineStart, lineEnd).trim();
		if (line === "" && blankLines === 0) {
			blankLines += 1;
			cursor = lineStart;
			continue;
		}
		if (line === MANAGED_MULTI_AGENT_V2_COMMENT) return true;
		if (!line.startsWith("#")) return false;
		cursor = lineStart;
	}
	return false;
}
