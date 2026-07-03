import type { ImageContent, TextContent, Tool } from "../types.ts";

/**
 * Supported tool call formats for models that don't natively support tool calling.
 * - "hermes": Hermes 2/3 format with special delimiters
 * - "xml": XML-based tool call format
 * - "gemma4-delimiter": Gemma 4 specific delimiter format
 */
export type ToolCallFormat = "hermes" | "xml" | "yaml-xml" | "gemma4-delimiter";

/**
 * Content type for tool results (text or image)
 */
export type ToolResultContent = TextContent | ImageContent;

export interface ParserOptions {
	emitRawToolCallTextOnError?: boolean;
	onError?: (message: string, metadata?: Record<string, unknown>) => void;
}

/**
 * A parsed tool call extracted from generated text
 */
export interface ParsedToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * Events emitted by the stream parser during text processing.
 * Maps 1:1 to AssistantMessageEventStream events for seamless integration.
 */
export type StreamParserEvent =
	| { type: "text"; text: string }
	| { type: "toolcall_start"; index: number; name: string; id: string }
	| { type: "toolcall_delta"; index: number; argumentsDelta: string }
	| {
			type: "toolcall_end";
			index: number;
			name: string;
			id: string;
			arguments: Record<string, unknown>;
	  };

/**
 * Stream parser for incremental tool call parsing during streaming.
 */
export interface StreamParser {
	/**
	 * Feed a text delta into the parser and receive any events generated.
	 * @param textDelta - The next chunk of text to parse
	 * @returns Array of parser events (text or tool call events)
	 */
	feed(textDelta: string): StreamParserEvent[];

	/**
	 * Signal that the stream has ended and receive any final events.
	 * @returns Array of final parser events
	 */
	finish(): StreamParserEvent[];
}

/**
 * Protocol interface for formatting and parsing tool calls in different formats.
 * Implementations handle the specifics of each tool call format (Hermes, XML, etc.)
 */
export interface ToolCallProtocol {
	/**
	 * Format tools into a system prompt that instructs the model how to use tools.
	 * @param tools - Array of available tools
	 * @returns Formatted system prompt string
	 */
	formatToolsSystemPrompt(tools: Tool[]): string;

	/**
	 * Format a tool response for inclusion in the conversation context.
	 * @param toolName - Name of the tool that was called
	 * @param toolCallId - Unique identifier for this tool call
	 * @param content - Array of content blocks (text or images) representing the result
	 * @returns Formatted tool response string
	 */
	formatToolResponse(toolName: string, toolCallId: string, content: ToolResultContent[]): string;

	/**
	 * Format a tool call for sending to the model.
	 * @param name - Name of the tool to call
	 * @param args - Arguments for the tool call
	 * @returns Formatted tool call string
	 */
	formatToolCall(name: string, args: Record<string, unknown>): string;

	/**
	 * Parse generated text to extract tool calls.
	 * @param text - The generated text to parse
	 * @param tools - Available tools for validation
	 * @returns Array of parsed tool calls
	 */
	parseGeneratedText(text: string, tools: Tool[], options?: ParserOptions): ParsedToolCall[];

	/**
	 * Create a stream parser for incremental parsing during streaming.
	 * @param tools - Available tools for the parser to recognize
	 * @returns A new StreamParser instance
	 */
	createStreamParser(tools: Tool[], options?: ParserOptions): StreamParser;
}
