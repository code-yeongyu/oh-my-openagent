/**
 * Runtime migration: force `[features.multi_agent_v2]` to `enabled = false`.
 *
 * Runs on every Codex SessionStart (via auto-update's config migration) so
 * multi-agent V2 stays off regardless of how it was turned on: an
 * installer-forced `enabled = true`, a missing `enabled` key the runtime
 * would resolve per model, or the `[features]` boolean shorthand
 * `multi_agent_v2 = true` (removed here because a boolean key and a
 * `[features.multi_agent_v2]` table for the same name are conflicting TOML).
 *
 * Upstream basis: openai/codex#26753 — with the flag on, EVERY turn fails
 * with a 400 ("spawn_agent declares encrypted parameters but is not
 * configured for encrypted tool use by this model"), even on prompts that
 * never touch subagents. OpenAI closed it NOT_PLANNED stating V2 is under
 * development, not recommended, and bug reports are not accepted. Same
 * failure class still being reported (openai/codex#27205).
 */
const MANAGED_COMMENT_MARKER = "openai/codex#26753";
const MANAGED_DISABLE_COMMENT = [
	"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
	`# because enabling it fails every turn with HTTP 400 (${MANAGED_COMMENT_MARKER}).`,
	"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).",
	"",
].join("\n");

export function forceDisableMultiAgentV2(config) {
	let result = removeEnabledFeaturesShorthand(config);
	const section = findSection(result, "[features.multi_agent_v2]");

	if (!section) {
		if (hasDisabledFeaturesShorthand(result)) return result;
		return ensureManagedComment(appendDisabledSection(result));
	}

	const enabledTruePattern = /^(\s*)enabled\s*=\s*true[ \t]*(#[^\n]*)?$/m;
	if (enabledTruePattern.test(section.text)) {
		const patched = section.text.replace(enabledTruePattern, (_match, indent, comment) => comment ? `${indent}enabled = false ${comment}` : `${indent}enabled = false`);
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

function removeEnabledFeaturesShorthand(config) {
	const section = findSection(config, "[features]");
	if (!section) return config;

	const shorthandPattern = /^\s*multi_agent_v2\s*=\s*true[ \t]*(?:#[^\n]*)?[ \t]*\n?/m;
	if (!shorthandPattern.test(section.text)) return config;

	const patched = section.text.replace(shorthandPattern, "");
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function hasDisabledFeaturesShorthand(config) {
	const section = findSection(config, "[features]");
	if (!section) return false;
	return /^\s*multi_agent_v2\s*=\s*false[ \t]*(?:#[^\n]*)?$/m.test(section.text);
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
