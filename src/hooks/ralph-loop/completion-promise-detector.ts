import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { withTimeout } from "./with-timeout"

interface OpenCodeSessionMessage {
	info?: { role?: string }
	parts?: Array<{ type: string; text?: string }>
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildPromisePattern(promise: string): RegExp {
	return new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
}

const SEMANTIC_COMPLETION_PATTERNS = [
	/\b(?:task|work|implementation|all\s+tasks?)\s+(?:is|are)\s+(?:complete|completed|done|finished)\b/i,
	/\ball\s+(?:items?|todos?|steps?)\s+(?:are\s+)?(?:complete|completed|done|finished|marked)\b/i,
	/\b(?:everything|all\s+work)\s+(?:is\s+)?(?:complete|completed|done|finished)\b/i,
	/\bsuccessfully\s+completed?\s+all\b/i,
	/\bnothing\s+(?:left|more|remaining)\s+to\s+(?:do|implement|fix)\b/i,
]

export function detectSemanticCompletion(text: string): boolean {
	return SEMANTIC_COMPLETION_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectCompletionInTranscript(
	transcriptPath: string | undefined,
	promise: string,
	startedAt?: string,
): boolean {
	if (!transcriptPath) return false

	try {
		if (!existsSync(transcriptPath)) return false

		const content = readFileSync(transcriptPath, "utf-8")
		const pattern = buildPromisePattern(promise)
		const lines = content.split("\n").filter((line) => line.trim())

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { type?: string; timestamp?: string }
				if (entry.type === "user") continue
				if (startedAt && entry.timestamp && entry.timestamp < startedAt) continue
				if (pattern.test(line)) return true
				// Fallback: semantic completion only for DONE promise and assistant entries
				const isAssistantEntry = entry.type === "assistant" || entry.type === "text"
				if (promise === "DONE" && isAssistantEntry && detectSemanticCompletion(line)) {
					log("[ralph-loop] WARNING: Semantic completion detected in transcript (agent used natural language instead of <promise>DONE</promise>)")
					return true
				}
			} catch {
				continue
			}
		}
		return false
	} catch {
		return false
	}
}

export async function detectCompletionInSessionMessages(
	ctx: PluginInput,
	options: {
		sessionID: string
		promise: string
		apiTimeoutMs: number
		directory: string
		sinceMessageIndex?: number
	},
): Promise<boolean> {
	try {
		const response = await withTimeout(
			ctx.client.session.messages({
				path: { id: options.sessionID },
				query: { directory: options.directory },
			}),
			options.apiTimeoutMs,
		)

		const messagesResponse: unknown = response
		const responseData =
			typeof messagesResponse === "object" && messagesResponse !== null && "data" in messagesResponse
				? (messagesResponse as { data?: unknown }).data
				: undefined

		const messageArray: unknown[] = Array.isArray(messagesResponse)
			? messagesResponse
			: Array.isArray(responseData)
				? responseData
				: []

		const scopedMessages =
			typeof options.sinceMessageIndex === "number" && options.sinceMessageIndex >= 0 && options.sinceMessageIndex < messageArray.length
				? messageArray.slice(options.sinceMessageIndex)
				: messageArray

		const assistantMessages = (scopedMessages as OpenCodeSessionMessage[]).filter((msg) => msg.info?.role === "assistant")
		if (assistantMessages.length === 0) return false

		const pattern = buildPromisePattern(options.promise)
		for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
			const assistant = assistantMessages[index]
			if (!assistant.parts) continue

			let responseText = ""
			for (const part of assistant.parts) {
				if (part.type !== "text" && part.type !== "tool_result") continue
				responseText += `${responseText ? "\n" : ""}${part.text ?? ""}`
			}

			if (pattern.test(responseText)) {
				return true
			}

			// Fallback: semantic completion only for DONE promise
			if (options.promise === "DONE" && detectSemanticCompletion(responseText)) {
				log("[ralph-loop] WARNING: Semantic completion detected (agent used natural language instead of <promise>DONE</promise>)", {
					sessionID: options.sessionID,
				})
				return true
			}
		}

		return false
	} catch (err) {
		setTimeout(() => {
			log(`[${HOOK_NAME}] Session messages check failed`, {
				sessionID: options.sessionID,
				error: String(err),
			})
		}, 0)
		return false
	}
}
