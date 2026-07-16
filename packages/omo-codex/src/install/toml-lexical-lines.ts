type MultilineStringKind = "basic" | "literal" | null;

export interface TomlLexicalLine {
	readonly text: string;
	readonly offset: number;
	readonly code: string;
	readonly tableHeader: string | null;
	readonly assignment: TomlAssignment | null;
}

export interface TomlAssignment {
	readonly key: string;
	readonly value: string;
	readonly start: number;
	readonly end: number;
	readonly indent: string;
	readonly comment: string;
	readonly newline: string;
}

export function scanTomlLines(config: string): readonly TomlLexicalLine[] {
	return scanTomlDocument(config).lines;
}

export function isTomlLexicallyValid(config: string): boolean {
	return scanTomlDocument(config).valid;
}

export function findTomlAssignment(
	config: string,
	key: string,
): TomlAssignment | null {
	for (const line of scanTomlLines(config)) {
		if (line.assignment?.key === key) return line.assignment;
	}
	return null;
}

function scanTomlDocument(config: string): {
	readonly lines: readonly TomlLexicalLine[];
	readonly valid: boolean;
} {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	const scanned: TomlLexicalLine[] = [];
	let multiline: MultilineStringKind = null;
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

export function isTomlTableHeaderLine(line: string): boolean {
	return isNormalizedTableHeader(stripTomlInlineComment(line).trim());
}

export function stripTomlInlineComment(line: string): string {
	return scanLine(line, null).code;
}

function scanLine(
	line: string,
	initialMultiline: MultilineStringKind,
): {
	readonly code: string;
	readonly multiline: MultilineStringKind;
	readonly valid: boolean;
} {
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
		if (line[index] === "#")
			return {
				code: structural ? line.slice(0, index) : "",
				multiline: null,
				valid: true,
			};
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

function findMultilineClose(
	line: string,
	start: number,
	delimiter: string,
): number {
	let index = line.indexOf(delimiter, start);
	while (index !== -1) {
		if (delimiter === "'''" || !isEscaped(line, index)) return index;
		index = line.indexOf(delimiter, index + 1);
	}
	return -1;
}

function isEscaped(line: string, index: number): boolean {
	let backslashes = 0;
	for (
		let cursor = index - 1;
		cursor >= 0 && line[cursor] === "\\";
		cursor -= 1
	)
		backslashes += 1;
	return backslashes % 2 === 1;
}

function skipBasicString(line: string, start: number): number {
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

function skipLiteralString(line: string, start: number): number {
	const close = line.indexOf("'", start);
	return close === -1 ? -1 : close + 1;
}

function readAssignment(
	text: string,
	code: string,
	offset: number,
): TomlAssignment | null {
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

function isNormalizedTableHeader(line: string): boolean {
	return line.startsWith("[") && line.endsWith("]");
}
