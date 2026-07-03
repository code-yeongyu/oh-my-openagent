import type { TSchema } from "typebox";
import type { ImageContent, TextContent, Tool } from "../../types.ts";
import type { ParsedToolCall, ParserOptions, StreamParser } from "../types.ts";
import { createJsonMixStreamParser, formatJsonMixToolCall, parseJsonMixGeneratedText } from "./json-mix.ts";

const TOOL_CALL_START = "<tool_call>";
const TOOL_CALL_END = "</tool_call>";

/**
 * Renders a single tool definition as Hermes format JSON.
 * Format: {"type": "function", "function": {"name": ..., "description": ..., "parameters": ...}}
 */
function renderToolDefinition(tool: Tool): string {
	const parameters = tool.parameters as TSchema & { static?: unknown };
	const parametersJson = JSON.stringify(parameters);
	const descriptionJson = JSON.stringify(tool.description);
	const nameJson = JSON.stringify(tool.name);

	return `{"type": "function", "function": {"name": ${nameJson}, "description": ${descriptionJson}, "parameters": ${parametersJson}}}`;
}

/**
 * Generates Hermes-style system prompt with tool definitions.
 * Tools are rendered inside <tools></tools> XML tags.
 * Includes pydantic model schema and tool call usage instructions.
 */
export function hermesFormatToolsSystemPrompt(tools: Tool[]): string {
	if (tools.length === 0) {
		return "";
	}

	const toolsRendered = tools.map(renderToolDefinition).join("\n");

	return `You are a function calling AI model. You are provided with function signatures within <tools></tools> XML tags. You may call one or more functions to assist with the user query. Don't make assumptions about what values to plug into functions. Here are the available tools: <tools> ${toolsRendered} </tools>
Use the following pydantic model json schema for each tool call you will make: {"properties": {"name": {"title": "Name", "type": "string"}, "arguments": {"title": "Arguments", "type": "object"}}, "required": ["name", "arguments"], "title": "FunctionCall", "type": "object"}
For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:
<tool_call>
{"name": "<function-name>", "arguments": <args-dict>}
</tool_call>`;
}

/**
 * Formats a tool response for Hermes protocol.
 * Format: <tool_response>{"name":"toolName","content":"..."}</tool_response>
 */
export function hermesFormatToolResponse(
	toolName: string,
	_toolCallId: string,
	content: (TextContent | ImageContent)[],
): string {
	const textContent = content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return `<tool_response>${JSON.stringify({
		name: toolName,
		content: textContent,
	})}</tool_response>`;
}

/**
 * Formats a tool call for Hermes protocol.
 * Format: <tool_call>\n{"name":"name","arguments":{...}}\n</tool_call>
 */
export function hermesFormatToolCall(name: string, args: Record<string, unknown>): string {
	return formatJsonMixToolCall(name, args, {
		toolCallStart: TOOL_CALL_START,
		toolCallEnd: TOOL_CALL_END,
	});
}

export function hermesParseGeneratedText(text: string, tools: Tool[], options?: ParserOptions): ParsedToolCall[] {
	return parseJsonMixGeneratedText(
		text,
		tools,
		{
			toolCallStart: TOOL_CALL_START,
			toolCallEnd: TOOL_CALL_END,
		},
		options,
	);
}

export function hermesCreateStreamParser(tools: Tool[], options?: ParserOptions): StreamParser {
	return createJsonMixStreamParser(
		tools,
		{
			toolCallStart: TOOL_CALL_START,
			toolCallEnd: TOOL_CALL_END,
			createToolCallId: (index) => `hermes-tool-${index}`,
		},
		options,
	);
}
