const MULTI_AGENT_MODE_KEY = "multi_agent_mode";

export function removeUnsupportedRootMultiAgentMode(config) {
	const lines = config.split(/\n/);
	const output = [];
	let inRoot = true;
	let changed = false;
	for (const line of lines) {
		const sectionHeader = isSectionHeader(line);
		if (inRoot && isRootSetting(line, MULTI_AGENT_MODE_KEY)) {
			changed = true;
			continue;
		}
		output.push(line);
		if (sectionHeader) inRoot = false;
	}
	return changed ? output.join("\n") : config;
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
