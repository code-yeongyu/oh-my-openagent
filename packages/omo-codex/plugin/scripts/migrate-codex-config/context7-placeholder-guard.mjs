const CONTEXT7_HEADER = "[mcp_servers.context7]";

export function removeStaleContext7PlaceholderMcpServer(config) {
	return removeSections(config, (section) => section.header === CONTEXT7_HEADER && isContext7PlaceholderSection(section.text));
}

function isContext7PlaceholderSection(sectionText) {
	const args = readStringArraySetting(sectionText, "args");
	if (args === null || !args.includes("@upstash/context7-mcp")) return false;
	const apiKey = valueAfter(args, "--api-key");
	return apiKey !== null && isPlaceholderApiKey(apiKey);
}

function valueAfter(values, key) {
	const index = values.indexOf(key);
	return index >= 0 ? values[index + 1] ?? null : null;
}

function isPlaceholderApiKey(value) {
	return /^your[-_ ]?api[-_ ]?key$/i.test(value);
}

function readStringArraySetting(sectionText, key) {
	for (const line of sectionText.split("\n")) {
		if (!new RegExp(`^\\s*${key}\\s*=`).test(line)) continue;
		const assignmentIndex = line.indexOf("=");
		if (assignmentIndex === -1) return null;
		return parseTomlStringArray(stripUnquotedInlineComment(line.slice(assignmentIndex + 1)).trim());
	}
	return null;
}

function parseTomlStringArray(value) {
	if (!value.startsWith("[") || !value.endsWith("]")) return null;
	const items = [];
	let index = 1;
	while (index < value.length - 1) {
		const char = value[index];
		if (char === "\"" || char === "'") {
			const parsed = parseTomlString(value, index);
			if (parsed === null) return null;
			items.push(parsed.value);
			index = parsed.nextIndex;
			continue;
		}
		index += 1;
	}
	return items;
}

function parseTomlString(input, startIndex) {
	const quote = input[startIndex];
	let value = "";
	let index = startIndex + 1;
	while (index < input.length) {
		const char = input[index];
		if (quote === "\"" && char === "\\") {
			const next = input[index + 1];
			if (next === undefined) return null;
			value += next;
			index += 2;
			continue;
		}
		if (char === quote) return { value, nextIndex: index + 1 };
		value += char;
		index += 1;
	}
	return null;
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

function removeSections(config, shouldRemove) {
	return splitSections(config)
		.filter((section) => !shouldRemove(section))
		.map((section) => section.text)
		.join("")
		.replace(/\n{3,}/g, "\n\n");
}

function splitSections(config) {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	const sections = [];
	let current = { header: null, text: "" };
	for (const line of lines) {
		if (line.length === 0) break;
		const header = tableHeader(line);
		if (header !== null) {
			if (current.text.length > 0) sections.push(current);
			current = { header, text: line };
		} else {
			current = { ...current, text: current.text + line };
		}
	}
	if (current.text.length > 0) sections.push(current);
	return sections;
}

function tableHeader(line) {
	const trimmed = stripUnquotedInlineComment(line).trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) return null;
	return trimmed;
}
