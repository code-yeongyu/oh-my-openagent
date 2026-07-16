export interface TomlSection {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export function findTomlSection(
	config: string,
	header: string,
): TomlSection | null {
	const headerLine = `[${header}]`;
	const targetHeaderPath = parseTomlDottedKey(header);
	let start = -1;
	for (const line of scanTomlLines(config)) {
		if (start === -1) {
			if (
				line.tableHeader !== null &&
				tomlTableHeaderMatches(line.tableHeader, headerLine, targetHeaderPath)
			) {
				start = line.offset;
			}
		} else if (line.tableHeader !== null) {
			return {
				start,
				end: line.offset,
				text: config.slice(start, line.offset),
			};
		}
	}
	if (start === -1) return null;
	return { start, end: config.length, text: config.slice(start) };
}

export function replaceOrInsertSetting(
	config: string,
	section: TomlSection,
	key: string,
	value: string,
): string {
	const assignment = findTomlAssignment(section.text, key);
	const replacement = assignment
		? replaceAssignment(section.text, assignment, key, value)
		: insertSetting(section.text, key, value);
	return (
		config.slice(0, section.start) + replacement + config.slice(section.end)
	);
}

export function removeSetting(
	config: string,
	section: TomlSection,
	key: string,
): string {
	const assignment = findTomlAssignment(section.text, key);
	if (!assignment) return config;
	const replacement =
		section.text.slice(0, assignment.start) +
		section.text.slice(assignment.end + assignment.newline.length);
	return (
		config.slice(0, section.start) + replacement + config.slice(section.end)
	);
}

export function replaceOrInsertRootSetting(
	config: string,
	key: string,
	value: string,
): string {
	const sectionStart = findFirstTableStart(config);
	const root = config.slice(0, sectionStart);
	const suffix = config.slice(sectionStart);
	const assignment = findTomlAssignment(root, key);
	const replacement = assignment
		? replaceAssignment(root, assignment, key, value)
		: `${root.trimEnd()}${root.trimEnd().length > 0 ? "\n" : ""}${key} = ${value}\n`;
	if (suffix.length === 0) return replacement;
	return `${replacement.trimEnd()}\n\n${suffix.trimStart()}`;
}

export function appendBlock(config: string, block: string): string {
	const prefix = config.trimEnd();
	return `${prefix}${prefix.length > 0 ? "\n\n" : ""}${block.trimEnd()}\n`;
}

function findFirstTableStart(config: string): number {
	for (const line of scanTomlLines(config)) {
		if (line.tableHeader !== null) return line.offset;
	}
	return config.length;
}

function insertSetting(
	sectionText: string,
	key: string,
	value: string,
): string {
	const lines = sectionText.split("\n");
	lines.splice(1, 0, `${key} = ${value}`);
	return lines.join("\n");
}

function replaceAssignment(
	text: string,
	assignment: TomlAssignment,
	key: string,
	value: string,
): string {
	const comment = assignment.comment.length > 0 ? ` ${assignment.comment}` : "";
	return `${text.slice(0, assignment.start)}${assignment.indent}${key} = ${value}${comment}${text.slice(assignment.end)}`;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tomlTableHeaderMatches(
	line: string,
	headerLine: string,
	targetHeaderPath: readonly string[] | null,
): boolean {
	const normalizedLine = stripTomlInlineComment(line).trim();
	if (normalizedLine === headerLine) return true;
	if (!targetHeaderPath) return false;
	const candidateHeaderPath = parseTomlTableHeader(normalizedLine);
	if (
		!candidateHeaderPath ||
		candidateHeaderPath.length !== targetHeaderPath.length
	)
		return false;
	return candidateHeaderPath.every(
		(part, index) => part === targetHeaderPath[index],
	);
}

function parseTomlTableHeader(line: string): readonly string[] | null {
	const normalizedLine = stripTomlInlineComment(line).trim();
	if (
		!normalizedLine.startsWith("[") ||
		!normalizedLine.endsWith("]") ||
		normalizedLine.startsWith("[[")
	)
		return null;
	return parseTomlDottedKey(normalizedLine.slice(1, -1).trim());
}

export { isTomlTableHeaderLine };

export function parseTomlDottedKey(input: string): readonly string[] | null {
	const parts: string[] = [];
	let index = 0;
	while (index < input.length) {
		index = skipWhitespace(input, index);
		const parsedKey = parseTomlKeyPart(input, index);
		if (!parsedKey) return null;
		parts.push(parsedKey.value);
		index = skipWhitespace(input, parsedKey.nextIndex);
		if (index === input.length) return parts;
		if (input[index] !== ".") return null;
		index += 1;
	}
	return parts.length > 0 ? parts : null;
}

function parseTomlKeyPart(
	input: string,
	startIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
	const quote = input[startIndex];
	if (quote === "'") return parseLiteralTomlString(input, startIndex);
	if (quote === '"') return parseBasicTomlString(input, startIndex);
	return parseBareTomlKey(input, startIndex);
}

function parseLiteralTomlString(
	input: string,
	startIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
	let index = startIndex + 1;
	let value = "";
	while (index < input.length) {
		const char = input[index];
		if (char === "'") return { value, nextIndex: index + 1 };
		value += char;
		index += 1;
	}
	return null;
}

function parseBasicTomlString(
	input: string,
	startIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
	let index = startIndex + 1;
	let value = "";
	while (index < input.length) {
		const char = input[index];
		if (char === '"') return { value, nextIndex: index + 1 };
		if (char !== "\\") {
			value += char;
			index += 1;
			continue;
		}
		const escaped = parseBasicTomlEscape(input, index);
		if (!escaped) return null;
		value += escaped.value;
		index = escaped.nextIndex;
	}
	return null;
}

function parseBasicTomlEscape(
	input: string,
	backslashIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
	const escapeCode = input[backslashIndex + 1];
	if (escapeCode === undefined) return null;
	if (escapeCode === "b") return { value: "\b", nextIndex: backslashIndex + 2 };
	if (escapeCode === "t") return { value: "\t", nextIndex: backslashIndex + 2 };
	if (escapeCode === "n") return { value: "\n", nextIndex: backslashIndex + 2 };
	if (escapeCode === "f") return { value: "\f", nextIndex: backslashIndex + 2 };
	if (escapeCode === "r") return { value: "\r", nextIndex: backslashIndex + 2 };
	if (escapeCode === '"') return { value: '"', nextIndex: backslashIndex + 2 };
	if (escapeCode === "\\")
		return { value: "\\", nextIndex: backslashIndex + 2 };
	if (escapeCode === "u")
		return parseUnicodeEscape(input, backslashIndex + 2, 4);
	if (escapeCode === "U")
		return parseUnicodeEscape(input, backslashIndex + 2, 8);
	return null;
}

function parseUnicodeEscape(
	input: string,
	digitsStart: number,
	digitCount: number,
): { readonly value: string; readonly nextIndex: number } | null {
	const digits = input.slice(digitsStart, digitsStart + digitCount);
	if (digits.length !== digitCount || !/^[0-9A-Fa-f]+$/.test(digits))
		return null;
	const codePoint = Number.parseInt(digits, 16);
	if (codePoint > 0x10ffff) return null;
	return {
		value: String.fromCodePoint(codePoint),
		nextIndex: digitsStart + digitCount,
	};
}

function parseBareTomlKey(
	input: string,
	startIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
	let index = startIndex;
	while (index < input.length && /[A-Za-z0-9_-]/.test(input[index])) index += 1;
	if (index === startIndex) return null;
	return { value: input.slice(startIndex, index), nextIndex: index };
}

function skipWhitespace(input: string, startIndex: number): number {
	let index = startIndex;
	while (index < input.length && /\s/.test(input[index])) index += 1;
	return index;
}

import {
	findTomlAssignment,
	isTomlTableHeaderLine,
	scanTomlLines,
	stripTomlInlineComment,
	type TomlAssignment,
} from "./toml-lexical-lines";
