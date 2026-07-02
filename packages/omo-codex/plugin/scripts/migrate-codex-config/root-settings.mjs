export const MANAGED_KEYS = ["model", "model_context_window", "model_reasoning_effort", "plan_mode_reasoning_effort"];

export function ensureCodexReasoningConfig(config, profile) {
	let next = replaceOrInsertRootSetting(config, "model", JSON.stringify(profile.model));
	next = replaceOrInsertRootSetting(next, "model_context_window", profile.model_context_window.toString());
	next = replaceOrInsertRootSetting(next, "model_reasoning_effort", JSON.stringify(profile.model_reasoning_effort));
	next = replaceOrInsertRootSetting(next, "plan_mode_reasoning_effort", JSON.stringify(profile.plan_mode_reasoning_effort));
	return next;
}

export function readRootSettings(config) {
	const settings = {};
	for (const line of config.split(/\n/)) {
		if (isSectionHeader(line)) break;
		for (const key of MANAGED_KEYS) {
			if (!isRootSetting(line, key)) continue;
			const value = parseTomlScalar(line.slice(line.indexOf("=") + 1));
			if (value !== undefined) settings[key] = value;
		}
	}
	return settings;
}

function parseTomlScalar(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed);
		} catch (error) {
			if (error instanceof SyntaxError) return undefined;
			throw error;
		}
	}
	const numeric = Number(trimmed);
	return Number.isFinite(numeric) ? numeric : undefined;
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
