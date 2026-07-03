import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages.js";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasMessagesArray(value: unknown): value is { messages: unknown[] } {
	return isObject(value) && Array.isArray(value.messages);
}

function isContentBlockParam(value: unknown): value is ContentBlockParam {
	return isObject(value) && typeof value.type === "string";
}

function isToolUseBlock(block: ContentBlockParam): block is Extract<ContentBlockParam, { type: "tool_use" }> {
	return block.type === "tool_use" && "id" in block && typeof block.id === "string";
}

function isToolResultBlock(block: ContentBlockParam): block is Extract<ContentBlockParam, { type: "tool_result" }> {
	return block.type === "tool_result";
}

function isMessageWithArrayContent(
	value: unknown,
	role: MessageParam["role"],
): value is MessageParam & { content: ContentBlockParam[] } {
	if (!isObject(value) || value.role !== role || !Array.isArray(value.content)) return false;
	for (const block of value.content) {
		if (!isContentBlockParam(block)) return false;
	}
	return true;
}

/** Removes orphan Anthropic tool_result blocks from provider payload messages. */
export function sanitizeAnthropicPayload(payload: unknown): unknown {
	if (!hasMessagesArray(payload)) return payload;

	const toolUseIds = new Set<string>();
	for (const unknownMessage of payload.messages) {
		if (!isMessageWithArrayContent(unknownMessage, "assistant")) continue;
		for (const unknownBlock of unknownMessage.content) {
			if (isToolUseBlock(unknownBlock) && unknownBlock.id.length > 0) toolUseIds.add(unknownBlock.id);
		}
	}

	let changed = false;
	const sanitizedMessages: unknown[] = [];

	for (const unknownMessage of payload.messages) {
		if (!isMessageWithArrayContent(unknownMessage, "user")) {
			sanitizedMessages.push(unknownMessage);
			continue;
		}

		const originalContent = unknownMessage.content;
		const nextContent: ContentBlockParam[] = [];
		let messageChanged = false;

		for (const block of originalContent) {
			if (!isToolResultBlock(block)) {
				nextContent.push(block);
				continue;
			}

			const toolUseId = block.tool_use_id;
			if (typeof toolUseId !== "string" || toolUseId.length === 0 || !toolUseIds.has(toolUseId)) {
				messageChanged = true;
				continue;
			}

			nextContent.push(block);
		}

		if (nextContent.length === 0) {
			changed = true;
			continue;
		}

		if (messageChanged) {
			changed = true;
			sanitizedMessages.push({ ...unknownMessage, content: nextContent });
			continue;
		}

		sanitizedMessages.push(unknownMessage);
	}

	if (!changed) return payload;
	return { ...payload, messages: sanitizedMessages };
}
