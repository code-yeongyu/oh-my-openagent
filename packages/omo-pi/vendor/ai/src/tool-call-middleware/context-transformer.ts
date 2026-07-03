import type {
	AssistantMessage,
	Context,
	Message,
	TextContent,
	ThinkingContent,
	ToolResultMessage,
	UserMessage,
} from "../types.ts";
import {
	gemma4CreateStreamParser,
	gemma4FormatToolCall,
	gemma4FormatToolResponse,
	gemma4FormatToolsSystemPrompt,
	gemma4ParseGeneratedText,
} from "./protocols/gemma4.ts";
import {
	hermesCreateStreamParser,
	hermesFormatToolCall,
	hermesFormatToolResponse,
	hermesFormatToolsSystemPrompt,
	hermesParseGeneratedText,
} from "./protocols/hermes.ts";
import {
	createMorphXmlStreamParser,
	morphXmlFormatToolCall,
	morphXmlFormatToolResponse,
	morphXmlFormatToolsSystemPrompt,
	parseMorphXmlGeneratedText,
} from "./protocols/morph-xml.ts";
import {
	createYamlXmlStreamParser,
	parseYamlXmlGeneratedText,
	yamlXmlFormatToolCall,
	yamlXmlFormatToolResponse,
	yamlXmlFormatToolsSystemPrompt,
} from "./protocols/yaml-xml.ts";
import type { ToolCallFormat, ToolCallProtocol } from "./types.ts";

/**
 * Hermes protocol implementation for tool call formatting and parsing.
 */
const hermesProtocol: ToolCallProtocol = {
	formatToolsSystemPrompt: hermesFormatToolsSystemPrompt,
	formatToolResponse: hermesFormatToolResponse,
	formatToolCall: hermesFormatToolCall,
	parseGeneratedText: hermesParseGeneratedText,
	createStreamParser: hermesCreateStreamParser,
};

/**
 * MorphXml protocol implementation for tool call formatting and parsing.
 */
const morphXmlProtocol: ToolCallProtocol = {
	formatToolsSystemPrompt: morphXmlFormatToolsSystemPrompt,
	formatToolResponse: morphXmlFormatToolResponse,
	formatToolCall: morphXmlFormatToolCall,
	parseGeneratedText: parseMorphXmlGeneratedText,
	createStreamParser: createMorphXmlStreamParser,
};

const yamlXmlProtocol: ToolCallProtocol = {
	formatToolsSystemPrompt: yamlXmlFormatToolsSystemPrompt,
	formatToolResponse: yamlXmlFormatToolResponse,
	formatToolCall: yamlXmlFormatToolCall,
	parseGeneratedText: parseYamlXmlGeneratedText,
	createStreamParser: createYamlXmlStreamParser,
};

/**
 * Gemma 4 protocol implementation for tool call formatting and parsing.
 */
const gemma4Protocol: ToolCallProtocol = {
	formatToolsSystemPrompt: gemma4FormatToolsSystemPrompt,
	formatToolResponse: gemma4FormatToolResponse,
	formatToolCall: gemma4FormatToolCall,
	parseGeneratedText: gemma4ParseGeneratedText,
	createStreamParser: gemma4CreateStreamParser,
};

/**
 * Protocol registry mapping format strings to protocol implementations.
 */
const protocolRegistry: Record<ToolCallFormat, ToolCallProtocol> = {
	hermes: hermesProtocol,
	xml: morphXmlProtocol,
	"yaml-xml": yamlXmlProtocol,
	"gemma4-delimiter": gemma4Protocol,
};

/**
 * Gets the protocol implementation for a given tool call format.
 * @param format - The tool call format
 * @returns The protocol implementation
 * @throws Error if the format is not supported
 */
export function getProtocol(format: ToolCallFormat): ToolCallProtocol {
	const protocol = protocolRegistry[format];
	if (!protocol) {
		throw new Error(`Unsupported tool call format: ${format}`);
	}
	return protocol;
}

/**
 * Transforms a context for text-based tool calling.
 * - Strips tools from context (provider sees tool-free request)
 * - Injects tool definitions into system prompt
 * - Converts tool call messages in history to text format
 * - Converts tool result messages to user messages with text content
 *
 * @param context - The original context
 * @param protocol - The protocol to use for formatting
 * @returns A new transformed context (original is not mutated)
 */
export function transformContext(context: Context, protocol: ToolCallProtocol): Context {
	// Build new context without mutating original
	const transformed: Context = {
		systemPrompt: context.systemPrompt,
		messages: context.messages.map((msg) => transformMessage(msg, protocol)),
		tools: undefined, // Strip tools - provider sees tool-free request
	};

	// Inject tool definitions into system prompt if tools exist
	if (context.tools && context.tools.length > 0) {
		const toolPrompt = protocol.formatToolsSystemPrompt(context.tools);
		if (toolPrompt) {
			transformed.systemPrompt = context.systemPrompt ? `${toolPrompt}\n\n${context.systemPrompt}` : toolPrompt;
		}
	}

	return transformed;
}

/**
 * Transforms a single message for text-based tool calling.
 * - AssistantMessage with ToolCall blocks: convert to text
 * - ToolResultMessage: convert to UserMessage with text content
 * - Other messages: pass through unchanged
 */
function transformMessage(message: Message, protocol: ToolCallProtocol): Message {
	switch (message.role) {
		case "assistant": {
			return transformAssistantMessage(message, protocol);
		}
		case "toolResult": {
			return transformToolResultMessage(message, protocol);
		}
		default: {
			return message;
		}
	}
}

/**
 * Transforms an AssistantMessage, converting ToolCall content blocks to text.
 */
function transformAssistantMessage(message: AssistantMessage, protocol: ToolCallProtocol): AssistantMessage {
	// Check if message has any ToolCall content blocks
	const hasToolCalls = message.content.some((block) => block.type === "toolCall");
	if (!hasToolCalls) {
		// No tool calls - pass through unchanged
		return message;
	}

	// Transform content blocks
	const newContent: (TextContent | ThinkingContent)[] = [];

	for (const block of message.content) {
		switch (block.type) {
			case "text": {
				newContent.push(block);
				break;
			}
			case "thinking": {
				newContent.push(block);
				break;
			}
			case "toolCall": {
				const toolCallText = protocol.formatToolCall(block.name, block.arguments);
				newContent.push({
					type: "text",
					text: toolCallText,
				});
				break;
			}
		}
	}

	// Return new AssistantMessage with transformed content
	return {
		...message,
		content: newContent,
	};
}

/**
 * Transforms a ToolResultMessage to a UserMessage with text content.
 */
function transformToolResultMessage(message: ToolResultMessage, protocol: ToolCallProtocol): UserMessage {
	// Format tool result as text using protocol formatter
	const formattedResponse = protocol.formatToolResponse(message.toolName, message.toolCallId, message.content);

	// Return as UserMessage with text content
	return {
		role: "user",
		content: formattedResponse,
		timestamp: message.timestamp,
	};
}
