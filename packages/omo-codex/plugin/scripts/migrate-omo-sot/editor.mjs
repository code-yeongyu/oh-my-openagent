import { stringEnd, stripJsonComments } from "./jsonc.mjs";

export function addCodexCodegraphValues(content, config, additions) {
	const codex = recordAt(config, "[codex]");
	const codexRange = findObjectPropertyRange(content, 0, "[codex]");
	if (!isRecord(codex) || codexRange === null) {
		return insertPropertiesIntoObject(content, 0, {
			"[codex]": {
				codegraph: additions,
			},
		});
	}

	const codegraph = recordAt(codex, "codegraph");
	const codegraphRange = findObjectPropertyRange(content, codexRange.valueStart, "codegraph");
	if (!isRecord(codegraph) || codegraphRange === null) {
		return insertPropertiesIntoObject(content, codexRange.valueStart, { codegraph: additions });
	}
	return insertPropertiesIntoObject(content, codegraphRange.valueStart, additions);
}

export function recordAt(value, key) {
	return isRecord(value) ? value[key] : undefined;
}

export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn(value, key) {
	return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function findObjectPropertyRange(content, objectStart, name) {
	const open = content.indexOf("{", objectStart);
	if (open < 0) return null;
	let index = open + 1;
	while (index < content.length) {
		index = skipTrivia(content, index);
		if (content[index] === "}") return null;
		if (content[index] !== "\"") return null;
		const end = stringEnd(content, index);
		const key = JSON.parse(content.slice(index, end));
		index = skipTrivia(content, end);
		if (content[index] !== ":") return null;
		const valueStart = skipTrivia(content, index + 1);
		const valueEnd = valueRangeEnd(content, valueStart);
		if (key === name) return { valueEnd, valueStart };
		index = skipTrivia(content, valueEnd);
		if (content[index] === ",") index += 1;
	}
	return null;
}

function insertPropertiesIntoObject(content, objectStart, properties) {
	const open = content.indexOf("{", objectStart);
	const close = matchingBrace(content, open);
	if (open < 0 || close < 0) return content;
	const entries = Object.entries(properties);
	if (entries.length === 0) return content;
	const parentIndent = lineIndent(content, open);
	const childIndent = `${parentIndent}  `;
	const body = entries.map(([key, value]) => `${childIndent}${JSON.stringify(key)}: ${formatJsoncValue(value, childIndent)}`).join(",\n");
	const hasProperty = /"[^"]+"\s*:/.test(stripJsonComments(content.slice(open + 1, close)));
	const beforeClose = content.slice(0, close).replace(/\s*$/, "");
	const suffix = content.slice(close);
	const comma = hasProperty && !beforeClose.endsWith(",") && !beforeClose.endsWith("{") ? "," : "";
	return `${beforeClose}${comma}\n${body}\n${parentIndent}${suffix}`;
}

function formatJsoncValue(value, indent) {
	if (!isRecord(value)) return JSON.stringify(value);
	const nextIndent = `${indent}  `;
	const entries = Object.entries(value).map(([key, entry]) => `${nextIndent}${JSON.stringify(key)}: ${formatJsoncValue(entry, nextIndent)}`);
	return `{\n${entries.join(",\n")}\n${indent}}`;
}

function valueRangeEnd(content, start) {
	const char = content[start];
	if (char === "{" || char === "[") return matchingBrace(content, start) + 1;
	if (char === "\"") return stringEnd(content, start);
	let index = start;
	while (index < content.length && content[index] !== "," && content[index] !== "}") index += 1;
	return index;
}

function matchingBrace(content, start) {
	const open = content[start];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	for (let index = start; index < content.length; index += 1) {
		const char = content[index];
		if (char === "\"") index = stringEnd(content, index) - 1;
		else if (char === "/" && content[index + 1] === "/") while (index < content.length && content[index] !== "\n") index += 1;
		else if (char === "/" && content[index + 1] === "*") {
			index += 2;
			while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) index += 1;
			index += 1;
		} else if (char === open) depth += 1;
		else if (char === close) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

function skipTrivia(content, index) {
	while (index < content.length) {
		if (/\s/.test(content[index])) index += 1;
		else if (content[index] === "/" && content[index + 1] === "/") while (index < content.length && content[index] !== "\n") index += 1;
		else if (content[index] === "/" && content[index + 1] === "*") {
			index += 2;
			while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) index += 1;
			index += 2;
		} else return index;
	}
	return index;
}

function lineIndent(content, index) {
	const lineStart = content.lastIndexOf("\n", index) + 1;
	const match = /^[ \t]*/.exec(content.slice(lineStart, index));
	return match?.[0] ?? "";
}
