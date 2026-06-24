const MULTI_AGENT_MODE_KEY = "multi_agent_mode";
const MULTI_AGENT_MODE_PROACTIVE = "proactive";

export function forceMultiAgentModeProactive(config) {
	if (readRootStringSetting(config, MULTI_AGENT_MODE_KEY) === MULTI_AGENT_MODE_PROACTIVE) return config;
	return replaceOrInsertRootSetting(config, MULTI_AGENT_MODE_KEY, JSON.stringify(MULTI_AGENT_MODE_PROACTIVE));
}

function readRootStringSetting(config, key) {
	for (const line of config.split(/\n/)) {
		if (isSectionHeader(line)) return null;
		const match = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
		if (match?.[1] === key) return match[2] ?? null;
	}
	return null;
}

function replaceOrInsertRootSetting(config, key, value) {
	const lines = config.split(/\n/);
	const output = [];
	let replaced = false;
	let inserted = false;
	let inRoot = true;
	for (const line of lines) {
		const sectionHeader = isSectionHeader(line);
		if (inRoot && !inserted && sectionHeader) {
			if (!replaced) output.push(`${key} = ${value}`);
			inserted = true;
		}
		if (inRoot && isRootSetting(line, key)) {
			if (!replaced) {
				output.push(`${key} = ${value}`);
				replaced = true;
			}
			continue;
		}
		output.push(line);
		if (sectionHeader) inRoot = false;
	}
	if (!replaced && !inserted) output.push(`${key} = ${value}`);
	return output.join("\n");
}

function isSectionHeader(line) {
	const trimmed = stripUnquotedInlineComment(line).trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function isRootSetting(line, key) {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("#") || trimmed.startsWith("[")) return false;
	const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
	return match?.[1] === key;
}

function stripUnquotedInlineComment(line) {
	let quote = null;
	let index = 0;
	while (index < line.length) {
		const char = line[index];
		if (quote === "\"") {
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === "\"") quote = null;
			index += 1;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = null;
			index += 1;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			index += 1;
			continue;
		}
		if (char === "#") return line.slice(0, index);
		index += 1;
	}
	return line;
}
