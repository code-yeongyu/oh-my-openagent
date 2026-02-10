import { consumeNewMessages, type CursorMessage } from "../../shared/session-cursor"

type SessionMessagePart = {
	type: string
	text?: string
	content?: unknown
}

export type SessionMessage = CursorMessage & {
	info?: CursorMessage["info"] & { role?: string }
	parts?: SessionMessagePart[]
}

function getRole(message: SessionMessage): string | null {
	const role = message.info?.role
	return typeof role === "string" ? role : null
}

function getCreatedTime(message: SessionMessage): number {
	const time = message.info?.time
	if (typeof time === "number") return time
	if (typeof time === "string") return Number(time) || 0
	const created = time?.created
	if (typeof created === "number") return created
	if (typeof created === "string") return Number(created) || 0
	return 0
}

function isRelevantRole(role: string | null): boolean {
	return role === "assistant" || role === "tool"
}

function extractTextFromParts(parts: SessionMessagePart[] | undefined): string[] {
	if (!parts) return []
	const extracted: string[] = []

	for (const part of parts) {
		if ((part.type === "text" || part.type === "reasoning") && part.text) {
			extracted.push(part.text)
			continue
		}
		if (part.type !== "tool_result") continue
		const content = part.content
		if (typeof content === "string" && content) {
			extracted.push(content)
			continue
		}
		if (!Array.isArray(content)) continue
		for (const block of content) {
			if (typeof block !== "object" || block === null) continue
			const record = block as Record<string, unknown>
			const typeValue = record["type"]
			const textValue = record["text"]
			if (
				(typeValue === "text" || typeValue === "reasoning") &&
				typeof textValue === "string" &&
				textValue
			) {
				extracted.push(textValue)
			}
		}
	}

	return extracted
}

export function extractNewSessionOutput(
	sessionID: string,
	messages: SessionMessage[],
): { output: string; hasNewOutput: boolean } {
	const relevantMessages = messages.filter((message) =>
		isRelevantRole(getRole(message)),
	)
	if (relevantMessages.length === 0) {
		return { output: "", hasNewOutput: false }
	}

	const sortedMessages = [...relevantMessages].sort(
		(a, b) => getCreatedTime(a) - getCreatedTime(b),
	)
	const newMessages = consumeNewMessages(sessionID, sortedMessages)
	if (newMessages.length === 0) {
		return { output: "", hasNewOutput: false }
	}

	const chunks: string[] = []
	for (const message of newMessages) {
		chunks.push(...extractTextFromParts(message.parts))
	}

	const output = chunks.filter((text) => text.length > 0).join("\n\n")
	return { output, hasNewOutput: output.length > 0 }
}
