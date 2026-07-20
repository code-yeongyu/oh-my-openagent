import type { Goal } from "./types.js";
import { isRecord } from "./types.js";

export function shouldQueueGoalContinuationWhenIdle(
	goal: Goal | null,
	isIdle: boolean,
	hasPendingMessages: boolean,
): goal is Goal {
	return goal?.status === "active" && isIdle && !hasPendingMessages;
}

export function shouldQueueGoalContinuationAfterAgentEnd(
	goal: Goal | null,
	hasPendingMessages: boolean,
	messages: readonly unknown[],
): goal is Goal {
	return goal?.status === "active" && !hasPendingMessages && didAgentEndCleanly(messages);
}

function didAgentEndCleanly(messages: readonly unknown[]): boolean {
	const lastAssistantIndex = findLastAssistantMessageIndex(messages);
	if (lastAssistantIndex === undefined) return false;

	const lastAssistant = messages[lastAssistantIndex];
	if (!isAssistantMessage(lastAssistant) || !isContinuableStopReason(lastAssistant["stopReason"])) return false;

	for (let index = lastAssistantIndex + 1; index < messages.length; index++) {
		const message = messages[index];
		if (isAbortedToolResult(message)) return false;
	}
	return true;
}

function findLastAssistantMessageIndex(messages: readonly unknown[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (isAssistantMessage(messages[index])) return index;
	}
	return undefined;
}

function isAssistantMessage(message: unknown): message is Record<string, unknown> {
	return isRecord(message) && message["role"] === "assistant";
}

function isContinuableStopReason(stopReason: unknown): boolean {
	return stopReason === "stop" || stopReason === "toolUse" || stopReason === "length";
}

function isAbortedToolResult(message: unknown): boolean {
	if (!isRecord(message) || message["role"] !== "toolResult" || message["isError"] !== true) return false;
	const content = message["content"];
	if (!Array.isArray(content)) return false;
	return content.some(
		(block) =>
			isRecord(block) &&
			block["type"] === "text" &&
			typeof block["text"] === "string" &&
			/\babort(?:ed)?\b/i.test(block["text"]),
	);
}
