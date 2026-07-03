function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasMessagesArray(value: unknown): value is { messages: unknown[] } {
	return isObject(value) && Array.isArray(value.messages);
}

const SYNTHETIC_OUTPUT = "Tool output unavailable (interrupted before result)";

type ChatCompletionMessage = Record<string, unknown>;
type ChatCompletionToolCall = Record<string, unknown> & { id: string };

function isToolCall(value: unknown): value is ChatCompletionToolCall {
	return isObject(value) && typeof value.id === "string" && value.id.length > 0;
}

function isMessageWithToolCalls(
	value: unknown,
): value is ChatCompletionMessage & { tool_calls: ChatCompletionToolCall[] } {
	if (!isObject(value) || value.role !== "assistant" || !Array.isArray(value.tool_calls)) return false;
	for (const call of value.tool_calls) {
		if (!isToolCall(call)) return false;
	}
	return true;
}

function isToolRoleMessage(value: unknown): value is ChatCompletionMessage {
	return isObject(value) && value.role === "tool";
}

function isToolMessage(value: unknown): value is ChatCompletionMessage & { tool_call_id: string } {
	return isObject(value) && value.role === "tool" && typeof value.tool_call_id === "string";
}

function createSyntheticToolMessage(toolCallId: string): ChatCompletionMessage {
	return {
		role: "tool",
		tool_call_id: toolCallId,
		content: SYNTHETIC_OUTPUT,
	};
}

function flushMissingToolResults(pendingToolCallIds: string[], sanitizedMessages: unknown[]): boolean {
	if (pendingToolCallIds.length === 0) return false;
	for (const toolCallId of pendingToolCallIds) {
		sanitizedMessages.push(createSyntheticToolMessage(toolCallId));
	}
	pendingToolCallIds.length = 0;
	return true;
}

/** Repairs OpenAI Chat Completions request messages by keeping tool call/output pairs balanced. */
export function sanitizeOpenAIChatCompletionsPayload(payload: unknown): unknown {
	if (!hasMessagesArray(payload)) return payload;

	let changed = false;
	const sanitizedMessages: unknown[] = [];
	const pendingToolCallIds: string[] = [];
	const pendingToolCallIdSet = new Set<string>();

	for (const message of payload.messages) {
		if (isMessageWithToolCalls(message)) {
			if (flushMissingToolResults(pendingToolCallIds, sanitizedMessages)) {
				pendingToolCallIdSet.clear();
				changed = true;
			}

			sanitizedMessages.push(message);
			for (const call of message.tool_calls) {
				pendingToolCallIds.push(call.id);
				pendingToolCallIdSet.add(call.id);
			}
			continue;
		}

		if (isToolRoleMessage(message)) {
			if (
				!isToolMessage(message) ||
				message.tool_call_id.length === 0 ||
				!pendingToolCallIdSet.has(message.tool_call_id)
			) {
				changed = true;
				continue;
			}

			sanitizedMessages.push(message);
			pendingToolCallIdSet.delete(message.tool_call_id);
			const pendingIndex = pendingToolCallIds.indexOf(message.tool_call_id);
			if (pendingIndex >= 0) pendingToolCallIds.splice(pendingIndex, 1);
			continue;
		}

		if (flushMissingToolResults(pendingToolCallIds, sanitizedMessages)) {
			pendingToolCallIdSet.clear();
			changed = true;
		}
		sanitizedMessages.push(message);
	}

	if (flushMissingToolResults(pendingToolCallIds, sanitizedMessages)) changed = true;

	if (!changed) return payload;
	return { ...payload, messages: sanitizedMessages };
}
