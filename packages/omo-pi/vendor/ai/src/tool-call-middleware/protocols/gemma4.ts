import type { ImageContent, TextContent, Tool } from "../../types.ts";
import type { ParsedToolCall, ParserOptions, StreamParser, StreamParserEvent } from "../types.ts";

const STRING_DELIM = '<|"|>';
const TOOL_CALL_START = "<|tool_call>";
const TOOL_CALL_END = "<tool_call|>";
const TURN_END = "<turn|>";
const TOOL_RESPONSE_START = "<|tool_response>";
const TOOL_CALL_REGEX = /<\|tool_call>call:([\w\-.]+)\{(.*?)\}(?:<tool_call\|>|<turn\|>)/gs;

/**
 * Formats a value for Gemma 4's custom serialization format.
 * Strings are wrapped in <|"|> delimiters.
 * Numbers, booleans, and null are rendered as bare values.
 * Objects and arrays are recursively formatted.
 */
function formatGemma4Value(value: unknown): string {
	if (value === null) {
		return "null";
	}

	if (value === undefined) {
		return "null";
	}

	if (typeof value === "string") {
		return STRING_DELIM + value + STRING_DELIM;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (Array.isArray(value)) {
		const items = value.map((item) => formatGemma4Value(item));
		return `[${items.join(",")}]`;
	}

	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value).map(([key, val]) => {
			return `${key}:${formatGemma4Value(val)}`;
		});
		return `{${entries.join(",")}}`;
	}

	return STRING_DELIM + String(value) + STRING_DELIM;
}

/**
 * Formats tool arguments for Gemma 4's custom format.
 * Returns the content inside the braces: key:<|"|>value<|"|>,...
 */
function formatGemma4Args(args: Record<string, unknown>): string {
	const entries = Object.entries(args).map(([key, value]) => {
		return `${key}:${formatGemma4Value(value)}`;
	});
	return entries.join(",");
}

/**
 * Formats a complete tool call in Gemma 4 format.
 * Format: <|tool_call>call:name{key:<|"|>value<|"|>,...}<tool_call|>
 */
export function gemma4FormatToolCall(name: string, args: Record<string, unknown>): string {
	const argsStr = formatGemma4Args(args);
	return `${TOOL_CALL_START}call:${name}{${argsStr}}${TOOL_CALL_END}`;
}

/**
 * Formats a tool response for Gemma 4.
 * Format: <|tool_response>content
 */
export function gemma4FormatToolResponse(
	_toolName: string,
	_toolCallId: string,
	content: (TextContent | ImageContent)[],
): string {
	const textParts: string[] = [];
	for (const item of content) {
		if (item.type === "text") {
			textParts.push(item.text);
		}
	}
	return TOOL_RESPONSE_START + textParts.join("\n");
}

/**
 * Generates a system prompt describing available tools for Gemma 4.
 * Includes tool definitions with JSON schemas and usage instructions.
 */
export function gemma4FormatToolsSystemPrompt(tools: Tool[]): string {
	if (tools.length === 0) {
		return "";
	}

	const toolDescriptions = tools.map((tool) => {
		const schema = JSON.stringify(tool.parameters, null, 3);
		return `Name: ${tool.name}
Description: ${tool.description}
Parameters Schema:
${schema}`;
	});

	return `You have access to the following tools. Use them when appropriate.

${toolDescriptions.join("\n\n")}

When you need to use a tool, format your response exactly like this:

${TOOL_CALL_START}call:name{key:${STRING_DELIM}value${STRING_DELIM}}${TOOL_CALL_END}

Important formatting rules:
- String values must be wrapped in ${STRING_DELIM} delimiters
- Numbers and booleans should be bare values (no delimiters)
- Multiple arguments are separated by commas
- Nested objects use {key:value} syntax
- Arrays use [value1,value2] syntax

Example:
${TOOL_CALL_START}call:get_weather{location:${STRING_DELIM}London${STRING_DELIM},unit:${STRING_DELIM}celsius${STRING_DELIM}}${TOOL_CALL_END}`;
}

function parseGemma4Value(valueString: string): unknown {
	const trimmedValue = valueString.trim();
	if (!trimmedValue) {
		return trimmedValue;
	}

	if (trimmedValue === "true") {
		return true;
	}

	if (trimmedValue === "false") {
		return false;
	}

	if (trimmedValue.includes(".")) {
		const parsedFloat = /^-?(?:\d+\.\d*|\.\d+)$/.test(trimmedValue) ? Number.parseFloat(trimmedValue) : Number.NaN;
		return Number.isNaN(parsedFloat) ? trimmedValue : parsedFloat;
	}

	if (/^-?\d+$/.test(trimmedValue)) {
		return Number.parseInt(trimmedValue, 10);
	}

	return trimmedValue;
}

function parseGemma4Array(arrayString: string, partial = false): unknown[] {
	const items: unknown[] = [];
	let index = 0;

	while (index < arrayString.length) {
		while (index < arrayString.length && [" ", ",", "\n", "\t"].includes(arrayString[index] ?? "")) {
			index += 1;
		}

		if (index >= arrayString.length) {
			break;
		}

		if (arrayString.startsWith(STRING_DELIM, index)) {
			index += STRING_DELIM.length;
			const endIndex = arrayString.indexOf(STRING_DELIM, index);
			if (endIndex === -1) {
				items.push(arrayString.slice(index));
				break;
			}

			items.push(arrayString.slice(index, endIndex));
			index = endIndex + STRING_DELIM.length;
			continue;
		}

		if (arrayString[index] === "{") {
			let depth = 1;
			const objectStart = index + 1;
			index += 1;

			while (index < arrayString.length && depth > 0) {
				if (arrayString.startsWith(STRING_DELIM, index)) {
					index += STRING_DELIM.length;
					const nextDelimiter = arrayString.indexOf(STRING_DELIM, index);
					index = nextDelimiter === -1 ? arrayString.length : nextDelimiter + STRING_DELIM.length;
					continue;
				}

				if (arrayString[index] === "{") {
					depth += 1;
				} else if (arrayString[index] === "}") {
					depth -= 1;
				}

				index += 1;
			}

			if (depth > 0) {
				items.push(parseGemma4Args(arrayString.slice(objectStart, index), true));
			} else {
				items.push(parseGemma4Args(arrayString.slice(objectStart, index - 1)));
			}
			continue;
		}

		if (arrayString[index] === "[") {
			let depth = 1;
			const subArrayStart = index + 1;
			index += 1;

			while (index < arrayString.length && depth > 0) {
				if (arrayString[index] === "[") {
					depth += 1;
				} else if (arrayString[index] === "]") {
					depth -= 1;
				}

				index += 1;
			}

			if (depth > 0) {
				items.push(parseGemma4Array(arrayString.slice(subArrayStart, index), true));
			} else {
				items.push(parseGemma4Array(arrayString.slice(subArrayStart, index - 1)));
			}
			continue;
		}

		const valueStart = index;
		while (index < arrayString.length && ![",", "]"].includes(arrayString[index] ?? "")) {
			index += 1;
		}

		if (partial && index >= arrayString.length) {
			break;
		}

		items.push(parseGemma4Value(arrayString.slice(valueStart, index)));
	}

	return items;
}

export function parseGemma4Args(argsString: string, partial = false): Record<string, unknown> {
	if (!argsString.trim()) {
		return {};
	}

	const result: Record<string, unknown> = {};
	let index = 0;

	while (index < argsString.length) {
		while (index < argsString.length && [" ", ",", "\n", "\t"].includes(argsString[index] ?? "")) {
			index += 1;
		}

		if (index >= argsString.length) {
			break;
		}

		const keyStart = index;
		while (index < argsString.length && argsString[index] !== ":") {
			index += 1;
		}

		if (index >= argsString.length) {
			break;
		}

		const key = argsString.slice(keyStart, index).trim();
		index += 1;

		if (index >= argsString.length) {
			if (!partial) {
				result[key] = "";
			}
			break;
		}

		while (index < argsString.length && [" ", "\n", "\t"].includes(argsString[index] ?? "")) {
			index += 1;
		}

		if (index >= argsString.length) {
			if (!partial) {
				result[key] = "";
			}
			break;
		}

		if (argsString.startsWith(STRING_DELIM, index)) {
			index += STRING_DELIM.length;
			const valueStart = index;
			const endIndex = argsString.indexOf(STRING_DELIM, index);
			if (endIndex === -1) {
				result[key] = argsString.slice(valueStart);
				break;
			}

			result[key] = argsString.slice(valueStart, endIndex);
			index = endIndex + STRING_DELIM.length;
			continue;
		}

		if (argsString[index] === "{") {
			let depth = 1;
			const objectStart = index + 1;
			index += 1;

			while (index < argsString.length && depth > 0) {
				if (argsString.startsWith(STRING_DELIM, index)) {
					index += STRING_DELIM.length;
					const nextDelimiter = argsString.indexOf(STRING_DELIM, index);
					index = nextDelimiter === -1 ? argsString.length : nextDelimiter + STRING_DELIM.length;
					continue;
				}

				if (argsString[index] === "{") {
					depth += 1;
				} else if (argsString[index] === "}") {
					depth -= 1;
				}

				index += 1;
			}

			if (depth > 0) {
				result[key] = parseGemma4Args(argsString.slice(objectStart, index), true);
			} else {
				result[key] = parseGemma4Args(argsString.slice(objectStart, index - 1));
			}
			continue;
		}

		if (argsString[index] === "[") {
			let depth = 1;
			const arrayStart = index + 1;
			index += 1;

			while (index < argsString.length && depth > 0) {
				if (argsString.startsWith(STRING_DELIM, index)) {
					index += STRING_DELIM.length;
					const nextDelimiter = argsString.indexOf(STRING_DELIM, index);
					index = nextDelimiter === -1 ? argsString.length : nextDelimiter + STRING_DELIM.length;
					continue;
				}

				if (argsString[index] === "[") {
					depth += 1;
				} else if (argsString[index] === "]") {
					depth -= 1;
				}

				index += 1;
			}

			if (depth > 0) {
				result[key] = parseGemma4Array(argsString.slice(arrayStart, index), true);
			} else {
				result[key] = parseGemma4Array(argsString.slice(arrayStart, index - 1));
			}
			continue;
		}

		const valueStart = index;
		while (index < argsString.length && ![",", "}", "]"].includes(argsString[index] ?? "")) {
			index += 1;
		}

		if (partial && index >= argsString.length) {
			break;
		}

		result[key] = parseGemma4Value(argsString.slice(valueStart, index));
	}

	return result;
}

function findCommonPrefix(left: string, right: string): string {
	const maxLength = Math.min(left.length, right.length);
	let index = 0;

	while (index < maxLength && left[index] === right[index]) {
		index += 1;
	}

	return left.slice(0, index);
}

function extractToolCalls(text: string): RegExpExecArray[] {
	return Array.from(text.matchAll(TOOL_CALL_REGEX));
}

function extractPartialToolCall(content: string): {
	name: string | null;
	rawArgs: string;
} {
	if (!content.startsWith("call:")) {
		return { name: null, rawArgs: "" };
	}

	const functionPart = content.slice(5);
	const braceIndex = functionPart.indexOf("{");
	if (braceIndex === -1) {
		return { name: null, rawArgs: "" };
	}

	const name = functionPart.slice(0, braceIndex).trim();
	let rawArgs = functionPart.slice(braceIndex + 1);
	if (rawArgs.endsWith("}")) {
		rawArgs = rawArgs.slice(0, -1);
	}

	return { name, rawArgs };
}

function stripTrailingUnsafeCharacters(argumentsJson: string): string {
	let safePrefix = argumentsJson;

	while (safePrefix.length > 0) {
		const trailingCharacter = safePrefix[safePrefix.length - 1];
		if (!trailingCharacter || !["}", '"', "]", "<", "|", "\\", ">"].includes(trailingCharacter)) {
			break;
		}

		safePrefix = safePrefix.slice(0, -1);
	}

	return safePrefix;
}

function getPartialTokenSuffix(text: string, tokens: string[]): string {
	for (const token of tokens) {
		for (let index = token.length - 1; index > 0; index -= 1) {
			const prefix = token.slice(0, index);
			if (text.endsWith(prefix)) {
				return prefix;
			}
		}
	}

	return "";
}

function findEarliestToken(text: string, tokens: string[]): { index: number; token: string } | null {
	let earliestMatch: { index: number; token: string } | null = null;

	for (const token of tokens) {
		const tokenIndex = text.indexOf(token);
		if (tokenIndex === -1) {
			continue;
		}

		if (!earliestMatch || tokenIndex < earliestMatch.index) {
			earliestMatch = { index: tokenIndex, token };
		}
	}

	return earliestMatch;
}

export function gemma4ParseGeneratedText(text: string, _tools: Tool[], _options?: ParserOptions): ParsedToolCall[] {
	const parsedToolCalls: ParsedToolCall[] = [];

	for (const match of extractToolCalls(text)) {
		const [, name, rawArgs] = match;
		if (!name || rawArgs === undefined) {
			continue;
		}

		parsedToolCalls.push({
			name,
			arguments: parseGemma4Args(rawArgs),
		});
	}

	return parsedToolCalls;
}

class Gemma4StreamParser implements StreamParser {
	private readonly toolCallIds: string[] = [];

	private plainTextCarry = "";
	private toolCallCarry = "";
	private insideToolCall = false;
	private toolCallContent = "";
	private currentToolIndex = -1;
	private currentToolName: string | null = null;
	private currentArgumentsJson = "";

	feed(textDelta: string): StreamParserEvent[] {
		const events: StreamParserEvent[] = [];
		let remaining = textDelta;

		while (remaining.length > 0) {
			if (!this.insideToolCall) {
				const combinedText = this.plainTextCarry + remaining;
				const startIndex = combinedText.indexOf(TOOL_CALL_START);

				if (startIndex === -1) {
					const partialSuffix = getPartialTokenSuffix(combinedText, [TOOL_CALL_START]);
					const flushableText = partialSuffix ? combinedText.slice(0, -partialSuffix.length) : combinedText;

					if (flushableText) {
						events.push({ type: "text", text: flushableText });
					}

					this.plainTextCarry = partialSuffix;
					break;
				}

				const textBeforeToolCall = combinedText.slice(0, startIndex);
				if (textBeforeToolCall) {
					events.push({ type: "text", text: textBeforeToolCall });
				}

				const afterStart = combinedText.slice(startIndex + TOOL_CALL_START.length);
				this.plainTextCarry = "";
				this.insideToolCall = true;
				this.toolCallContent = "";
				this.toolCallCarry = "";
				this.currentToolIndex += 1;
				this.currentToolName = null;
				this.currentArgumentsJson = "";
				this.toolCallIds[this.currentToolIndex] = `gemma4-tool-${this.currentToolIndex}`;
				remaining = afterStart;
				continue;
			}

			const combinedToolCall = this.toolCallCarry + remaining;
			const endMatch = findEarliestToken(combinedToolCall, [TOOL_CALL_END, TURN_END]);

			if (!endMatch) {
				const partialSuffix = getPartialTokenSuffix(combinedToolCall, [TOOL_CALL_END, TURN_END]);
				const flushableContent = partialSuffix
					? combinedToolCall.slice(0, -partialSuffix.length)
					: combinedToolCall;

				this.toolCallCarry = partialSuffix;
				if (flushableContent) {
					this.toolCallContent += flushableContent;
					this.emitPartialToolCall(events);
				}
				break;
			}

			const contentBeforeEnd = combinedToolCall.slice(0, endMatch.index);
			this.toolCallContent += contentBeforeEnd;
			this.toolCallCarry = "";
			this.emitPartialToolCall(events);
			this.emitCompletedToolCall(events);

			this.insideToolCall = false;
			this.toolCallContent = "";
			this.currentToolName = null;
			this.currentArgumentsJson = "";
			remaining = combinedToolCall.slice(endMatch.index + endMatch.token.length);
		}

		return events;
	}

	finish(): StreamParserEvent[] {
		const events: StreamParserEvent[] = [];

		if (!this.insideToolCall && this.plainTextCarry) {
			events.push({ type: "text", text: this.plainTextCarry });
		}

		if (this.insideToolCall) {
			const unfinishedToolCall = TOOL_CALL_START + this.toolCallContent + this.toolCallCarry;
			if (unfinishedToolCall) {
				events.push({ type: "text", text: unfinishedToolCall });
			}
		}

		this.plainTextCarry = "";
		this.toolCallCarry = "";
		this.insideToolCall = false;
		this.toolCallContent = "";
		this.currentToolName = null;
		this.currentArgumentsJson = "";

		return events;
	}

	private emitPartialToolCall(events: StreamParserEvent[]): void {
		const { name, rawArgs } = extractPartialToolCall(this.toolCallContent);
		if (!name) {
			return;
		}

		if (!this.currentToolName) {
			this.currentToolName = name;
			events.push({
				type: "toolcall_start",
				index: this.currentToolIndex,
				name,
				id: this.toolCallIds[this.currentToolIndex] ?? `gemma4-tool-${this.currentToolIndex}`,
			});
		}

		if (!rawArgs) {
			return;
		}

		const parsedArguments = parseGemma4Args(rawArgs, true);
		if (Object.keys(parsedArguments).length === 0) {
			return;
		}

		const currentArgumentsJson = JSON.stringify(parsedArguments);
		const safeArgumentsJson = stripTrailingUnsafeCharacters(currentArgumentsJson);
		if (!safeArgumentsJson || safeArgumentsJson === this.currentArgumentsJson) {
			return;
		}

		if (this.currentArgumentsJson) {
			const commonPrefix = findCommonPrefix(this.currentArgumentsJson, safeArgumentsJson);
			if (commonPrefix.length < this.currentArgumentsJson.length) {
				this.currentArgumentsJson = commonPrefix;
				return;
			}
		}

		const argumentsDelta = safeArgumentsJson.slice(this.currentArgumentsJson.length);
		if (!argumentsDelta) {
			return;
		}

		this.currentArgumentsJson = safeArgumentsJson;
		events.push({
			type: "toolcall_delta",
			index: this.currentToolIndex,
			argumentsDelta,
		});
	}

	private emitCompletedToolCall(events: StreamParserEvent[]): void {
		const { name, rawArgs } = extractPartialToolCall(this.toolCallContent);
		if (!name) {
			return;
		}

		if (!this.currentToolName) {
			this.currentToolName = name;
			events.push({
				type: "toolcall_start",
				index: this.currentToolIndex,
				name,
				id: this.toolCallIds[this.currentToolIndex] ?? `gemma4-tool-${this.currentToolIndex}`,
			});
		}

		const argumentsObject = parseGemma4Args(rawArgs);
		const argumentsJson = JSON.stringify(argumentsObject);
		const finalDelta = argumentsJson.slice(this.currentArgumentsJson.length);
		if (finalDelta) {
			events.push({
				type: "toolcall_delta",
				index: this.currentToolIndex,
				argumentsDelta: finalDelta,
			});
		}

		events.push({
			type: "toolcall_end",
			index: this.currentToolIndex,
			name,
			id: this.toolCallIds[this.currentToolIndex] ?? `gemma4-tool-${this.currentToolIndex}`,
			arguments: argumentsObject,
		});
	}
}

export function gemma4CreateStreamParser(_tools: Tool[], _options?: ParserOptions): StreamParser {
	return new Gemma4StreamParser();
}
