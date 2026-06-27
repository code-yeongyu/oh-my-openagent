const CODEX_AGENTS_HEADER = "[agents]";
const CODEX_MULTI_AGENT_V2_HEADER = "[features.multi_agent_v2]";
const CODEX_SUBAGENT_THREAD_LIMIT = "1000";

export function ensureSubagentConcurrencyLimit(config) {
	return ensureMultiAgentV2ThreadLimit(ensureAgentsMaxThreads(config));
}

function ensureAgentsMaxThreads(config) {
	const section = findSection(config, CODEX_AGENTS_HEADER);
	if (!section) return appendBlock(config, `${CODEX_AGENTS_HEADER}\nmax_threads = ${CODEX_SUBAGENT_THREAD_LIMIT}\n`);
	return replaceOrInsertSetting(config, section, "max_threads", CODEX_SUBAGENT_THREAD_LIMIT);
}

function ensureMultiAgentV2ThreadLimit(config) {
	const section = findSection(config, CODEX_MULTI_AGENT_V2_HEADER);
	if (!section) {
		return appendBlock(
			config,
			`${CODEX_MULTI_AGENT_V2_HEADER}\nmax_concurrent_threads_per_session = ${CODEX_SUBAGENT_THREAD_LIMIT}\n`,
		);
	}
	return replaceOrInsertSetting(config, section, "max_concurrent_threads_per_session", CODEX_SUBAGENT_THREAD_LIMIT);
}

function replaceOrInsertSetting(config, section, key, value) {
	const pattern = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=\\s*[^\\n#]*(#[^\\n]*)?$`, "m");
	if (pattern.test(section.text)) {
		const patched = section.text.replace(pattern, (_match, indent, comment) => comment ? `${indent}${key} = ${value} ${comment}` : `${indent}${key} = ${value}`);
		return config.slice(0, section.start) + patched + config.slice(section.end);
	}

	const headerEnd = section.text.indexOf("\n");
	const insertAt = headerEnd === -1 ? section.text.length : headerEnd + 1;
	const patched = `${section.text.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}${key} = ${value}\n${section.text.slice(insertAt)}`;
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function appendBlock(config, block) {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}${block}`;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
