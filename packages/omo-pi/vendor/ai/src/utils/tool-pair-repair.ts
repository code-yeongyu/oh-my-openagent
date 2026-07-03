import type { Message, TextContent } from "../types.ts";

export const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)";

/** Repairs orphaned tool results and dangling tool calls. */
export function repairOrphanedToolResults(messages: Message[]): Message[] {
	const toolCallIds = new Set<string>();
	const toolResultIds = new Set<string>();
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "toolCall") toolCallIds.add(block.id);
			}
		}
		if (message.role === "toolResult") toolResultIds.add(message.toolCallId);
	}

	const output: Message[] = [];
	const dangling = new Set([...toolCallIds].filter((id) => !toolResultIds.has(id)));

	for (const message of messages) {
		if (message.role === "toolResult") {
			if (!toolCallIds.has(message.toolCallId)) {
				output.push({
					...message,
					content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }] satisfies TextContent[],
				});
				continue;
			}
			output.push(message);
			continue;
		}

		output.push(message);
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall" || !dangling.has(block.id)) continue;
				output.push({
					role: "toolResult",
					toolCallId: block.id,
					toolName: block.name,
					content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
					isError: false,
					timestamp: message.timestamp ? message.timestamp + 1 : Date.now(),
				});
				dangling.delete(block.id);
			}
		}
	}

	return output;
}
