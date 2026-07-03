import type { Tool } from "../../types.ts";
import type { ParsedToolCall, ParserOptions, StreamParser, StreamParserEvent } from "../types.ts";

type JsonMixOptions = {
	toolCallStart: string;
	toolCallEnd: string;
	createToolCallId: (index: number) => string;
};

function shouldEmitRawToolCallTextOnError(options?: ParserOptions): boolean {
	return options?.emitRawToolCallTextOnError === true;
}

const JSON_WHITESPACE_REGEX = /\s/;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolNames(tools: Tool[]): Set<string> {
	return new Set(tools.map((tool) => tool.name));
}

function removeTrailingCommas(text: string): string {
	let result = "";
	let inString = false;
	let isEscaping = false;

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];

		if (inString) {
			result += character;
			if (isEscaping) {
				isEscaping = false;
			} else if (character === "\\") {
				isEscaping = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
			result += character;
			continue;
		}

		if (character === ",") {
			let lookAheadIndex = index + 1;
			while (lookAheadIndex < text.length && JSON_WHITESPACE_REGEX.test(text[lookAheadIndex] ?? "")) {
				lookAheadIndex += 1;
			}

			const nextCharacter = text[lookAheadIndex];
			if (nextCharacter === "}" || nextCharacter === "]") {
				continue;
			}
		}

		result += character;
	}

	return result;
}

function normalizeMalformedObjectKeys(text: string): string {
	return text.replace(/"([A-Za-z0-9_.$-]+)'(?=\s*:)/g, '"$1"');
}

function ensureObjectDelimiters(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return trimmed;
	}

	if (trimmed.includes(":")) {
		return `{${trimmed}}`;
	}

	return trimmed;
}

function trimExcessTrailingClosers(text: string): string {
	let openBraces = 0;
	let closeBraces = 0;
	for (const character of text) {
		if (character === "{") {
			openBraces += 1;
		} else if (character === "}") {
			closeBraces += 1;
		}
	}

	let excessClosers = closeBraces - openBraces;
	if (excessClosers <= 0) {
		return text;
	}

	let result = text;
	while (excessClosers > 0 && result.endsWith("}")) {
		result = result.slice(0, -1);
		excessClosers -= 1;
	}
	return result;
}

function parseRelaxedJson(text: string): unknown {
	const attempts = [
		text,
		removeTrailingCommas(text),
		normalizeMalformedObjectKeys(removeTrailingCommas(text)),
		ensureObjectDelimiters(normalizeMalformedObjectKeys(removeTrailingCommas(text))),
		trimExcessTrailingClosers(ensureObjectDelimiters(normalizeMalformedObjectKeys(removeTrailingCommas(text)))),
	];

	let lastError: unknown;
	for (const candidate of attempts) {
		try {
			return JSON.parse(candidate);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError instanceof Error ? lastError : new Error("Failed to parse relaxed JSON");
}

function parseToolCallJson(text: string, tools: Tool[]): ParsedToolCall | null {
	try {
		const parsedValue = parseRelaxedJson(text);
		if (!isRecord(parsedValue)) {
			return null;
		}

		if (typeof parsedValue.name !== "string") {
			return null;
		}

		if (!normalizeToolNames(tools).has(parsedValue.name)) {
			return null;
		}

		if (!isRecord(parsedValue.arguments)) {
			return null;
		}

		return {
			name: parsedValue.name,
			arguments: parsedValue.arguments,
		};
	} catch {
		return null;
	}
}

function skipJsonWhitespace(text: string, fromIndex: number): number {
	let index = fromIndex;
	while (index < text.length && JSON_WHITESPACE_REGEX.test(text[index] ?? "")) {
		index += 1;
	}
	return index;
}

function findTopLevelPropertyValueStart(text: string, property: string): number | null {
	const objectStart = skipJsonWhitespace(text, 0);
	if (objectStart >= text.length || text.charAt(objectStart) !== "{") {
		return null;
	}

	let depth = 0;
	let inString = false;
	let isEscaping = false;

	for (let index = objectStart; index < text.length; index += 1) {
		const character = text.charAt(index);

		if (inString) {
			if (isEscaping) {
				isEscaping = false;
			} else if (character === "\\") {
				isEscaping = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === "{") {
			depth += 1;
			continue;
		}
		if (character === "}") {
			depth = Math.max(0, depth - 1);
			continue;
		}
		if (character !== '"') {
			continue;
		}

		if (depth !== 1) {
			inString = true;
			continue;
		}

		const keyStart = index + 1;
		let keyEnd = keyStart;
		let keyEscaping = false;
		while (keyEnd < text.length) {
			const keyCharacter = text.charAt(keyEnd);
			if (keyEscaping) {
				keyEscaping = false;
			} else if (keyCharacter === "\\") {
				keyEscaping = true;
			} else if (keyCharacter === '"') {
				break;
			}
			keyEnd += 1;
		}

		if (keyEnd >= text.length || text.charAt(keyEnd) !== '"') {
			return null;
		}

		const key = text.slice(keyStart, keyEnd);
		let valueCursor = skipJsonWhitespace(text, keyEnd + 1);
		if (valueCursor >= text.length || text.charAt(valueCursor) !== ":") {
			index = keyEnd;
			continue;
		}

		valueCursor = skipJsonWhitespace(text, valueCursor + 1);
		if (key === property) {
			return valueCursor < text.length ? valueCursor : null;
		}

		index = valueCursor - 1;
	}

	return null;
}

function extractTopLevelStringProperty(text: string, property: string): string | undefined {
	const valueStart = findTopLevelPropertyValueStart(text, property);
	if (valueStart == null || valueStart >= text.length) {
		return undefined;
	}

	if (text.charAt(valueStart) !== '"') {
		return undefined;
	}

	let valueEnd = valueStart + 1;
	let isEscaping = false;
	while (valueEnd < text.length) {
		const character = text.charAt(valueEnd);
		if (isEscaping) {
			isEscaping = false;
		} else if (character === "\\") {
			isEscaping = true;
		} else if (character === '"') {
			return text.slice(valueStart + 1, valueEnd);
		}
		valueEnd += 1;
	}

	return undefined;
}

function extractJsonValueSlice(text: string, valueStart: number): { text: string; complete: boolean } | null {
	if (valueStart >= text.length) {
		return null;
	}

	const firstCharacter = text.charAt(valueStart);
	if (firstCharacter === "{" || firstCharacter === "[") {
		const stack: string[] = [firstCharacter];
		let inString = false;
		let isEscaping = false;

		for (let index = valueStart + 1; index < text.length; index += 1) {
			const character = text.charAt(index);
			if (inString) {
				if (isEscaping) {
					isEscaping = false;
				} else if (character === "\\") {
					isEscaping = true;
				} else if (character === '"') {
					inString = false;
				}
				continue;
			}

			if (character === '"') {
				inString = true;
				continue;
			}

			if (character === "{" || character === "[") {
				stack.push(character);
				continue;
			}

			if (character === "}" || character === "]") {
				const openCharacter = stack[stack.length - 1];
				if ((openCharacter === "{" && character === "}") || (openCharacter === "[" && character === "]")) {
					stack.pop();
					if (stack.length === 0) {
						return {
							text: text.slice(valueStart, index + 1),
							complete: true,
						};
					}
				}
			}
		}

		return {
			text: text.slice(valueStart),
			complete: false,
		};
	}

	if (firstCharacter === '"') {
		let isEscaping = false;
		for (let index = valueStart + 1; index < text.length; index += 1) {
			const character = text.charAt(index);
			if (isEscaping) {
				isEscaping = false;
			} else if (character === "\\") {
				isEscaping = true;
			} else if (character === '"') {
				return {
					text: text.slice(valueStart, index + 1),
					complete: true,
				};
			}
		}

		return {
			text: text.slice(valueStart),
			complete: false,
		};
	}

	let index = valueStart;
	while (index < text.length) {
		const character = text.charAt(index);
		if (character === "," || character === "}" || JSON_WHITESPACE_REGEX.test(character)) {
			break;
		}
		index += 1;
	}

	return {
		text: text.slice(valueStart, index),
		complete: index < text.length,
	};
}

function getPotentialStartIndex(text: string, searchedText: string): number | null {
	if (searchedText.length === 0) {
		return null;
	}

	const directIndex = text.indexOf(searchedText);
	if (directIndex !== -1) {
		return directIndex;
	}

	const startAt = Math.max(0, text.length - searchedText.length + 1);
	for (let index = startAt; index < text.length; index += 1) {
		let isMatch = true;
		const suffixLength = text.length - index;

		for (let suffixIndex = 0; suffixIndex < suffixLength; suffixIndex += 1) {
			if (text[index + suffixIndex] !== searchedText[suffixIndex]) {
				isMatch = false;
				break;
			}
		}

		if (isMatch) {
			return index;
		}
	}

	return null;
}

function extractArgumentsProgress(toolCallJson: string): {
	toolName: string | undefined;
	argumentsText: string | undefined;
	argumentsComplete: boolean;
} {
	const toolName = extractTopLevelStringProperty(toolCallJson, "name");
	const argumentsStart = findTopLevelPropertyValueStart(toolCallJson, "arguments");
	if (argumentsStart == null) {
		return {
			toolName,
			argumentsText: undefined,
			argumentsComplete: false,
		};
	}

	const argumentsSlice = extractJsonValueSlice(toolCallJson, argumentsStart);
	return {
		toolName,
		argumentsText: argumentsSlice?.text,
		argumentsComplete: argumentsSlice?.complete ?? false,
	};
}

type JsonMixStreamState = {
	activeToolCall: {
		index: number;
		id: string;
		name: string;
		emittedArguments: string;
	} | null;
	buffer: string;
	currentToolCallJson: string;
	isInsideToolCall: boolean;
	toolCallCount: number;
};

function emitText(events: StreamParserEvent[], text: string): void {
	if (text.length === 0) {
		return;
	}

	events.push({ type: "text", text });
}

function emitToolCallProgress(
	state: JsonMixStreamState,
	events: StreamParserEvent[],
	tools: Tool[],
	options: JsonMixOptions,
): void {
	if (!state.isInsideToolCall || state.currentToolCallJson.length === 0) {
		return;
	}

	const progress = extractArgumentsProgress(state.currentToolCallJson);
	if (
		!progress.toolName ||
		!normalizeToolNames(tools).has(progress.toolName) ||
		!progress.argumentsText ||
		!progress.argumentsComplete
	) {
		return;
	}

	try {
		const parsedArguments = parseRelaxedJson(progress.argumentsText);
		if (!isRecord(parsedArguments)) {
			return;
		}

		if (!state.activeToolCall) {
			state.activeToolCall = {
				index: state.toolCallCount,
				id: options.createToolCallId(state.toolCallCount),
				name: progress.toolName,
				emittedArguments: "",
			};
			state.toolCallCount += 1;
			events.push({
				type: "toolcall_start",
				index: state.activeToolCall.index,
				name: state.activeToolCall.name,
				id: state.activeToolCall.id,
			});
		}

		const canonicalArguments = JSON.stringify(parsedArguments);
		if (!canonicalArguments.startsWith(state.activeToolCall.emittedArguments)) {
			state.activeToolCall.emittedArguments = "";
		}

		const argumentsDelta = canonicalArguments.slice(state.activeToolCall.emittedArguments.length);
		if (argumentsDelta.length === 0) {
			return;
		}

		state.activeToolCall.emittedArguments = canonicalArguments;
		events.push({
			type: "toolcall_delta",
			index: state.activeToolCall.index,
			argumentsDelta,
		});
	} catch {}
}

function finalizeToolCall(
	state: JsonMixStreamState,
	events: StreamParserEvent[],
	tools: Tool[],
	options: JsonMixOptions,
	parserOptions?: ParserOptions,
): void {
	const fullSegment = `${options.toolCallStart}${state.currentToolCallJson}${options.toolCallEnd}`;
	const parsedToolCall = parseToolCallJson(state.currentToolCallJson, tools);
	if (!parsedToolCall) {
		parserOptions?.onError?.("Could not process JSON tool call, keeping original text.", {
			toolCall: fullSegment,
		});
		if (shouldEmitRawToolCallTextOnError(parserOptions)) {
			emitText(events, fullSegment);
		}
		state.activeToolCall = null;
		state.currentToolCallJson = "";
		state.isInsideToolCall = false;
		return;
	}

	if (!state.activeToolCall) {
		state.activeToolCall = {
			index: state.toolCallCount,
			id: options.createToolCallId(state.toolCallCount),
			name: parsedToolCall.name,
			emittedArguments: "",
		};
		state.toolCallCount += 1;
		events.push({
			type: "toolcall_start",
			index: state.activeToolCall.index,
			name: state.activeToolCall.name,
			id: state.activeToolCall.id,
		});
	}

	const canonicalArguments = JSON.stringify(parsedToolCall.arguments);
	if (canonicalArguments !== state.activeToolCall.emittedArguments) {
		const argumentsDelta = canonicalArguments.slice(state.activeToolCall.emittedArguments.length);
		if (argumentsDelta.length > 0) {
			events.push({
				type: "toolcall_delta",
				index: state.activeToolCall.index,
				argumentsDelta,
			});
		}
	}

	events.push({
		type: "toolcall_end",
		index: state.activeToolCall.index,
		name: parsedToolCall.name,
		id: state.activeToolCall.id,
		arguments: parsedToolCall.arguments,
	});

	state.activeToolCall = null;
	state.currentToolCallJson = "";
	state.isInsideToolCall = false;
}

function flushInsideToolCallBuffer(
	state: JsonMixStreamState,
	events: StreamParserEvent[],
	tools: Tool[],
	options: JsonMixOptions,
): void {
	const potentialEndIndex = getPotentialStartIndex(state.buffer, options.toolCallEnd);
	if (potentialEndIndex != null && potentialEndIndex + options.toolCallEnd.length > state.buffer.length) {
		state.currentToolCallJson += state.buffer.slice(0, potentialEndIndex);
		state.buffer = state.buffer.slice(potentialEndIndex);
		emitToolCallProgress(state, events, tools, options);
		return;
	}

	state.currentToolCallJson += state.buffer;
	state.buffer = "";
	emitToolCallProgress(state, events, tools, options);
}

function flushOutsideToolCallBuffer(
	state: JsonMixStreamState,
	events: StreamParserEvent[],
	options: JsonMixOptions,
): void {
	const potentialStartIndex = getPotentialStartIndex(state.buffer, options.toolCallStart);
	if (potentialStartIndex != null && potentialStartIndex + options.toolCallStart.length > state.buffer.length) {
		emitText(events, state.buffer.slice(0, potentialStartIndex));
		state.buffer = state.buffer.slice(potentialStartIndex);
		return;
	}

	emitText(events, state.buffer);
	state.buffer = "";
}

export function formatJsonMixToolCall(
	name: string,
	args: Record<string, unknown>,
	options: Pick<JsonMixOptions, "toolCallStart" | "toolCallEnd">,
): string {
	return `${options.toolCallStart}\n${JSON.stringify({ name, arguments: args })}\n${options.toolCallEnd}`;
}

export function parseJsonMixGeneratedText(
	text: string,
	tools: Tool[],
	options: Pick<JsonMixOptions, "toolCallStart" | "toolCallEnd">,
	parserOptions?: ParserOptions,
): ParsedToolCall[] {
	const parsedToolCalls: ParsedToolCall[] = [];
	const toolCallRegex = new RegExp(
		`${escapeRegExp(options.toolCallStart)}([\\s\\S]*?)${escapeRegExp(options.toolCallEnd)}`,
		"g",
	);

	let match = toolCallRegex.exec(text);
	while (match !== null) {
		const toolCallJson = match[1] ?? "";
		const parsedToolCall = parseToolCallJson(toolCallJson, tools);
		if (parsedToolCall) {
			parsedToolCalls.push(parsedToolCall);
		} else {
			parserOptions?.onError?.("Could not process JSON tool call, keeping original text.", {
				toolCall: match[0],
			});
		}
		match = toolCallRegex.exec(text);
	}

	return parsedToolCalls;
}

export function createJsonMixStreamParser(
	tools: Tool[],
	options: JsonMixOptions,
	parserOptions?: ParserOptions,
): StreamParser {
	const state: JsonMixStreamState = {
		activeToolCall: null,
		buffer: "",
		currentToolCallJson: "",
		isInsideToolCall: false,
		toolCallCount: 0,
	};

	return {
		feed(textDelta: string): StreamParserEvent[] {
			const events: StreamParserEvent[] = [];
			state.buffer += textDelta;

			let nextTagIndex = getPotentialStartIndex(
				state.buffer,
				state.isInsideToolCall ? options.toolCallEnd : options.toolCallStart,
			);

			while (nextTagIndex != null) {
				const currentTag = state.isInsideToolCall ? options.toolCallEnd : options.toolCallStart;
				if (nextTagIndex + currentTag.length > state.buffer.length) {
					break;
				}

				if (state.isInsideToolCall) {
					state.currentToolCallJson += state.buffer.slice(0, nextTagIndex);
					state.buffer = state.buffer.slice(nextTagIndex + currentTag.length);
					emitToolCallProgress(state, events, tools, options);
					finalizeToolCall(state, events, tools, options, parserOptions);
				} else {
					emitText(events, state.buffer.slice(0, nextTagIndex));
					state.buffer = state.buffer.slice(nextTagIndex + currentTag.length);
					state.isInsideToolCall = true;
					state.currentToolCallJson = "";
					state.activeToolCall = null;
				}

				nextTagIndex = getPotentialStartIndex(
					state.buffer,
					state.isInsideToolCall ? options.toolCallEnd : options.toolCallStart,
				);
			}

			if (state.isInsideToolCall) {
				flushInsideToolCallBuffer(state, events, tools, options);
			} else {
				flushOutsideToolCallBuffer(state, events, options);
			}

			return events;
		},
		finish(): StreamParserEvent[] {
			const events: StreamParserEvent[] = [];

			if (state.isInsideToolCall) {
				const unfinishedToolCall = `${options.toolCallStart}${state.currentToolCallJson}${state.buffer}`;
				parserOptions?.onError?.("Could not complete streaming JSON tool call at finish.", {
					toolCall: unfinishedToolCall,
				});
				if (shouldEmitRawToolCallTextOnError(parserOptions)) {
					emitText(events, unfinishedToolCall);
				}
				state.activeToolCall = null;
				state.currentToolCallJson = "";
				state.isInsideToolCall = false;
				state.buffer = "";
				return events;
			}

			emitText(events, state.buffer);
			state.buffer = "";
			return events;
		},
	};
}
