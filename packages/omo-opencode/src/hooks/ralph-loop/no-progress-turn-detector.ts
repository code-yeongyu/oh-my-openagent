import type { PluginInput } from "@opencode-ai/plugin"
import { isRecord, log, normalizeSDKResponse } from "../../shared"
import { withTimeout } from "./with-timeout"

type SessionMessage = {
	readonly info?: unknown
	readonly role?: unknown
	readonly parts?: readonly unknown[]
	readonly finish?: unknown
	readonly tokens?: unknown
}

function getMessageRole(message: SessionMessage): string | undefined {
	const info = isRecord(message.info) ? message.info : undefined
	return typeof info?.role === "string"
		? info.role
		: typeof message.role === "string"
			? message.role
			: undefined
}

function getMessageFinish(message: SessionMessage): string | undefined {
	const info = isRecord(message.info) ? message.info : undefined
	return typeof info?.finish === "string"
		? info.finish
		: typeof message.finish === "string"
			? message.finish
			: undefined
}

function getTokenCount(tokens: unknown, key: "input" | "output" | "reasoning"): number | undefined {
	if (!isRecord(tokens)) return undefined
	const value = tokens[key]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getCacheTokenCount(tokens: unknown, key: "write" | "read"): number | undefined {
	if (!isRecord(tokens)) return undefined
	const cache = tokens.cache
	if (!isRecord(cache)) return undefined
	const value = cache[key]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getMessageTokens(message: SessionMessage): unknown {
	const info = isRecord(message.info) ? message.info : undefined
	return info?.tokens ?? message.tokens
}

function allTokenCountsAreZero(message: SessionMessage): boolean {
	const tokens = getMessageTokens(message)
	const counts = [
		getTokenCount(tokens, "input"),
		getTokenCount(tokens, "output"),
		getTokenCount(tokens, "reasoning"),
		getCacheTokenCount(tokens, "write"),
		getCacheTokenCount(tokens, "read"),
	]
	return counts.every((count) => count === 0)
}

function partHasAssistantContent(part: unknown): boolean {
	if (!isRecord(part)) return false
	const type = typeof part.type === "string" ? part.type : undefined
	if (type === "step-start" || type === "step-finish") return false
	const text = typeof part.text === "string" ? part.text.trim() : ""
	return type !== undefined || text.length > 0
}

function hasAssistantContent(message: SessionMessage): boolean {
	return message.parts?.some(partHasAssistantContent) ?? false
}

function isNoProgressAssistantMessage(message: SessionMessage): boolean {
	return getMessageRole(message) === "assistant"
		&& getMessageFinish(message) === "unknown"
		&& allTokenCountsAreZero(message)
		&& !hasAssistantContent(message)
}

export async function latestAssistantTurnMadeNoProgress(
	ctx: PluginInput,
	input: {
		readonly sessionID: string
		readonly directory: string
		readonly apiTimeoutMs: number
		readonly sinceMessageIndex?: number
	},
): Promise<boolean> {
	try {
		const response = await withTimeout(
			ctx.client.session.messages({
				path: { id: input.sessionID },
				query: { directory: input.directory },
			}),
			input.apiTimeoutMs,
		)
		const messages = normalizeSDKResponse<readonly SessionMessage[]>(response, [])
		const scopedMessages =
			typeof input.sinceMessageIndex === "number" && input.sinceMessageIndex >= 0
				? messages.slice(Math.min(input.sinceMessageIndex, messages.length))
				: messages
		for (let index = scopedMessages.length - 1; index >= 0; index -= 1) {
			const message = scopedMessages[index]
			if (!message) continue
			const role = getMessageRole(message)
			if (role === "assistant") return isNoProgressAssistantMessage(message)
			if (role === "user" || role === "tool") return false
		}
		return false
	} catch (error) {
		const errorText = error instanceof Error ? String(error) : String(error)
		log("[ralph-loop] Failed to detect no-progress assistant turn", {
			sessionID: input.sessionID,
			error: errorText,
		})
		return false
	}
}
