import { findTomlAssignment, findTomlSection } from "./toml-lexical-lines.mjs";

const MANAGED_COMMENT_MARKER = "openai/codex#26753";
const MANAGED_DISABLE_COMMENT = [
	"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
	`# because enabling it fails every turn with HTTP 400 (${MANAGED_COMMENT_MARKER}).`,
	"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).",
	"",
].join("\n");
const MANAGED_MULTI_AGENT_MODE_HINT =
	"Work directly on trivial or bounded tasks. Delegate only when specialization, meaningful parallelism, unresolved complexity, or an explicit plan materially improves the result. Do not delegate merely because agents are available. Preserve focused delegation for genuinely heavy work.";

export function clearMultiAgentV2DisableForReservedSchema(config) {
	const result = removeManagedDisableComments(config);
	const section = findTomlSection(result, "[features.multi_agent_v2]");
	if (!section) return appendV2PreferredSection(result);
	const cleared = removeSetting(section.text, "enabled", "false");
	const withoutDisable =
		cleared === section.text
			? result
			: result.slice(0, section.start) + cleared + result.slice(section.end);
	return ensureV2PreferredSettings(withoutDisable);
}

export function ensureV2CompatibilitySettings(config) {
	return findTomlSection(config, "[features.multi_agent_v2]")
		? ensureV2PreferredSettings(config)
		: appendV2PreferredSection(config);
}

export function forceDisableLegacyEncryptedV2(config) {
	const section = findTomlSection(config, "[features.multi_agent_v2]");
	if (!section) return ensureManagedComment(appendDisabledSection(config));
	if (findTomlAssignment(section.text, "enabled")?.value === "true") {
		const patched = replaceOrInsertSetting(
			section.text,
			null,
			"enabled",
			"false",
		);
		return ensureManagedComment(
			config.slice(0, section.start) + patched + config.slice(section.end),
		);
	}
	if (findTomlAssignment(section.text, "enabled")?.value === "false")
		return config;
	const headerEnd = section.text.indexOf("\n");
	const insertAt = headerEnd === -1 ? section.text.length : headerEnd + 1;
	const patched = `${section.text.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}enabled = false\n${section.text.slice(insertAt)}`;
	return ensureManagedComment(
		config.slice(0, section.start) + patched + config.slice(section.end),
	);
}

export function removeFeaturesShorthand(config) {
	const section = findTomlSection(config, "[features]");
	if (!section) return config;
	const value = findTomlAssignment(section.text, "multi_agent_v2")?.value;
	if (value !== "true" && value !== "false") return config;
	const patched = removeSetting(section.text, "multi_agent_v2");
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function ensureV2PreferredSettings(config) {
	let result = ensureMultiAgentModeHint(config);
	result = replaceOrInsertV2Setting(
		result,
		"hide_spawn_agent_metadata",
		"false",
	);
	return replaceOrInsertV2Setting(result, "tool_namespace", '"agents"');
}

function ensureMultiAgentModeHint(config) {
	const section = findTomlSection(config, "[features.multi_agent_v2]");
	if (
		!section ||
		findTomlAssignment(section.text, "multi_agent_mode_hint_text")
	)
		return config;
	return replaceOrInsertSetting(
		config,
		section,
		"multi_agent_mode_hint_text",
		JSON.stringify(MANAGED_MULTI_AGENT_MODE_HINT),
	);
}

function replaceOrInsertV2Setting(config, key, value) {
	const section = findTomlSection(config, "[features.multi_agent_v2]");
	return section ? replaceOrInsertSetting(config, section, key, value) : config;
}

function ensureManagedComment(config) {
	const section = findTomlSection(config, "[features.multi_agent_v2]");
	if (!section || adjacentManagedCommentStart(config, section.start) !== null)
		return config;
	return (
		config.slice(0, section.start) +
		MANAGED_DISABLE_COMMENT +
		config.slice(section.start)
	);
}

function removeManagedDisableComments(config) {
	const section = findTomlSection(config, "[features.multi_agent_v2]");
	if (!section) return config;
	const start = adjacentManagedCommentStart(config, section.start);
	if (start === null) return config;
	const kept = config
		.slice(start, section.start)
		.split(/(?<=\n)/)
		.filter((line) => !isManagedCommentLine(line.trim()))
		.join("");
	return config.slice(0, start) + kept + config.slice(section.start);
}

function appendDisabledSection(config) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}[features.multi_agent_v2]\nenabled = false\n`;
}

function appendV2PreferredSection(config) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return [
		`${prefix}[features.multi_agent_v2]`,
		'tool_namespace = "agents"',
		"hide_spawn_agent_metadata = false",
		`multi_agent_mode_hint_text = ${JSON.stringify(MANAGED_MULTI_AGENT_MODE_HINT)}`,
		"",
	].join("\n");
}

function replaceOrInsertSetting(config, section, key, value) {
	const text = section?.text ?? config;
	const assignment = findTomlAssignment(text, key);
	if (assignment) {
		const comment = assignment.comment ? ` ${assignment.comment}` : "";
		const patched = `${text.slice(0, assignment.start)}${assignment.indent}${key} = ${value}${comment}${text.slice(assignment.end)}`;
		return section
			? config.slice(0, section.start) + patched + config.slice(section.end)
			: patched;
	}
	const headerEnd = text.indexOf("\n");
	const insertAt = headerEnd === -1 ? text.length : headerEnd + 1;
	const patched = `${text.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}${key} = ${value}\n${text.slice(insertAt)}`;
	return section
		? config.slice(0, section.start) + patched + config.slice(section.end)
		: patched;
}

function removeSetting(text, key, expectedValue) {
	const assignment = findTomlAssignment(text, key);
	if (
		!assignment ||
		(expectedValue !== undefined && assignment.value !== expectedValue)
	)
		return text;
	return (
		text.slice(0, assignment.start) +
		text.slice(assignment.end + assignment.newline.length)
	);
}

function adjacentManagedCommentStart(config, sectionStart) {
	let cursor = sectionStart;
	let start = sectionStart;
	let found = false;
	let blankLines = 0;
	while (cursor > 0) {
		const lineEnd = config[cursor - 1] === "\n" ? cursor - 1 : cursor;
		const lineStart = config.lastIndexOf("\n", lineEnd - 1) + 1;
		const line = config.slice(lineStart, lineEnd).trim();
		if (line === "" && blankLines === 0) {
			blankLines += 1;
			start = lineStart;
			cursor = lineStart;
			continue;
		}
		if (!line.startsWith("#")) break;
		found = found || line === MANAGED_DISABLE_COMMENT.split("\n")[0];
		start = lineStart;
		cursor = lineStart;
	}
	return found ? start : null;
}

function isManagedCommentLine(line) {
	return (
		line === MANAGED_DISABLE_COMMENT.split("\n")[0] ||
		line ===
			`# because enabling it fails every turn with HTTP 400 (${MANAGED_COMMENT_MARKER}).` ||
		line ===
			"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1)." ||
		line.startsWith("# Work around openai/codex#26753:")
	);
}
