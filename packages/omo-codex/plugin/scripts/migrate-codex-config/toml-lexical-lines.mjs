/** @typedef {'basic' | 'literal' | null} MultilineStringKind */

export function scanTomlLines(config) {
	return scanTomlDocument(config).lines;
}

export function isTomlLexicallyValid(config) {
	return scanTomlDocument(config).valid;
}

export function findTomlAssignment(config, key) {
	for (const line of scanTomlLines(config)) {
		if (line.assignment?.key === key) return line.assignment;
	}
	return null;
}

export function findTomlSection(config, headerLine) {
	const target = parseTomlTableHeader(headerLine);
	let start = -1;
	for (const line of scanTomlLines(config)) {
		if (start === -1) {
			if (
				line.tableHeader !== null &&
				tableHeadersMatch(line.tableHeader, headerLine, target)
			) {
				start = line.offset;
			}
			continue;
		}
		if (line.tableHeader !== null) {
			return {
				start,
				end: line.offset,
				text: config.slice(start, line.offset),
			};
		}
	}
	return start === -1
		? null
		: { start, end: config.length, text: config.slice(start) };
}

function scanTomlDocument(config) {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	const scanned = [];
	/** @type {MultilineStringKind} */
	let multiline = null;
	let valid = true;
	let offset = 0;
	for (const text of lines) {
		if (text.length === 0) break;
		const startedInsideMultiline = multiline !== null;
		const result = scanLine(text, multiline);
		multiline = result.multiline;
		valid = valid && result.valid;
		const code = startedInsideMultiline ? "" : result.code;
		const normalized = code.trim();
		scanned.push({
			text,
			offset,
			code,
			tableHeader: isNormalizedTableHeader(normalized) ? normalized : null,
			assignment: readAssignment(text, code, offset),
		});
		offset += text.length;
	}
	return { lines: scanned, valid: valid && multiline === null };
}

function scanLine(line, initialMultiline) {
	let multiline = initialMultiline;
	let index = 0;
	const structural = multiline === null;
	while (index < line.length) {
		if (multiline !== null) {
			const delimiter = multiline === "basic" ? '"""' : "'''";
			const close = findMultilineClose(line, index, delimiter);
			if (close === -1)
				return { code: structural ? line : "", multiline, valid: true };
			multiline = null;
			index = close + delimiter.length;
			continue;
		}
		if (line[index] === "#") {
			return {
				code: structural ? line.slice(0, index) : "",
				multiline: null,
				valid: true,
			};
		}
		if (line.startsWith('"""', index)) {
			multiline = "basic";
			index += 3;
			continue;
		}
		if (line.startsWith("'''", index)) {
			multiline = "literal";
			index += 3;
			continue;
		}
		if (line[index] === '"') {
			const close = skipBasicString(line, index + 1);
			if (close === -1) return { code: line, multiline, valid: false };
			index = close;
			continue;
		}
		if (line[index] === "'") {
			const close = skipLiteralString(line, index + 1);
			if (close === -1) return { code: line, multiline, valid: false };
			index = close;
			continue;
		}
		index += 1;
	}
	return { code: structural ? line : "", multiline, valid: true };
}

function findMultilineClose(line, start, delimiter) {
	let index = line.indexOf(delimiter, start);
	while (index !== -1) {
		if (delimiter === "'''" || !isEscaped(line, index)) return index;
		index = line.indexOf(delimiter, index + 1);
	}
	return -1;
}

function isEscaped(line, index) {
	let backslashes = 0;
	for (
		let cursor = index - 1;
		cursor >= 0 && line[cursor] === "\\";
		cursor -= 1
	) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

function skipBasicString(line, start) {
	let index = start;
	while (index < line.length) {
		if (line[index] === "\\") {
			index += 2;
			continue;
		}
		if (line[index] === '"') return index + 1;
		index += 1;
	}
	return -1;
}

function skipLiteralString(line, start) {
	const close = line.indexOf("'", start);
	return close === -1 ? -1 : close + 1;
}

function readAssignment(text, code, offset) {
	if (code.length === 0) return null;
	const match =
		/^([ \t]*)([A-Za-z0-9_-]+)[ \t]*=[ \t]*(.*?)[ \t]*(?:\r?\n)?$/.exec(code);
	if (!match) return null;
	const newline = text.endsWith("\r\n")
		? "\r\n"
		: text.endsWith("\n")
			? "\n"
			: "";
	const contentEnd = text.length - newline.length;
	return {
		key: match[2],
		value: match[3],
		start: offset,
		end: offset + contentEnd,
		indent: match[1],
		comment: text
			.slice(code.replace(/\r?\n$/, "").length, contentEnd)
			.trimStart(),
		newline,
	};
}

function tableHeadersMatch(candidate, targetLine, targetPath) {
	if (candidate === targetLine) return true;
	const candidatePath = parseTomlTableHeader(candidate);
	return (
		candidatePath !== null &&
		targetPath !== null &&
		candidatePath.length === targetPath.length &&
		candidatePath.every((part, index) => part === targetPath[index])
	);
}

function parseTomlTableHeader(line) {
	const trimmed = line.trim();
	if (
		!trimmed.startsWith("[") ||
		!trimmed.endsWith("]") ||
		trimmed.startsWith("[[")
	)
		return null;
	return parseTomlDottedKey(trimmed.slice(1, -1).trim());
}

function parseTomlDottedKey(input) {
	const parts = [];
	let index = 0;
	while (index < input.length) {
		while (/\s/.test(input[index] ?? "")) index += 1;
		const parsed = parseKeyPart(input, index);
		if (parsed === null) return null;
		parts.push(parsed.value);
		index = parsed.nextIndex;
		while (/\s/.test(input[index] ?? "")) index += 1;
		if (index === input.length) return parts;
		if (input[index] !== ".") return null;
		index += 1;
	}
	return parts.length > 0 ? parts : null;
}

function parseKeyPart(input, start) {
	const quote = input[start];
	if (quote === "'" || quote === '"') {
		let index = start + 1;
		let value = "";
		while (index < input.length) {
			if (input[index] === quote) return { value, nextIndex: index + 1 };
			if (quote === '"' && input[index] === "\\") {
				const escaped = input[index + 1];
				if (escaped !== '"' && escaped !== "\\") return null;
				value += escaped;
				index += 2;
				continue;
			}
			value += input[index];
			index += 1;
		}
		return null;
	}
	let index = start;
	while (/[A-Za-z0-9_-]/.test(input[index] ?? "")) index += 1;
	return index === start
		? null
		: { value: input.slice(start, index), nextIndex: index };
}

function isNormalizedTableHeader(line) {
	return line.startsWith("[") && line.endsWith("]");
}
