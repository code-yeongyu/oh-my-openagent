import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Goal } from "./types.ts";

type AssistantAgentMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolResultAgentMessage = Extract<AgentMessage, { role: "toolResult" }>;

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
	messages: readonly AgentMessage[],
): goal is Goal {
	return goal?.status === "active" && !hasPendingMessages && didAgentEndCleanly(messages);
}

function didAgentEndCleanly(messages: readonly AgentMessage[]): boolean {
	const lastAssistantIndex = findLastAssistantMessageIndex(messages);
	if (lastAssistantIndex === undefined) return false;

	const lastAssistant = messages[lastAssistantIndex];
	if (lastAssistant?.role !== "assistant" || !isContinuableStopReason(lastAssistant.stopReason)) return false;

	for (let index = lastAssistantIndex + 1; index < messages.length; index++) {
		const message = messages[index];
		if (message?.role === "toolResult" && isAbortedToolResult(message)) return false;
	}
	return true;
}

function findLastAssistantMessageIndex(messages: readonly AgentMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "assistant") {
			return index;
		}
	}
	return undefined;
}

function isContinuableStopReason(stopReason: AssistantAgentMessage["stopReason"]): boolean {
	return stopReason === "stop" || stopReason === "toolUse" || stopReason === "length";
}

function isAbortedToolResult(message: ToolResultAgentMessage): boolean {
	if (!message.isError) return false;
	return message.content.some((content) => content.type === "text" && /\babort(?:ed)?\b/i.test(content.text));
}
