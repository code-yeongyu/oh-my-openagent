import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { detectSemanticCompletion } from "./semantic-completion-detector"
import { withTimeout } from "./with-timeout"

interface OpenCodeSessionMessage {
	info?: { role?: string }
	parts?: Array<{ type: string; text?: string }>
}

function getAssistantMessageText(message: OpenCodeSessionMessage): string {
	if (!message.parts) return ""

	let responseText = ""
	for (const part of message.parts) {
		if (part.type !== "text") continue
		responseText += `${responseText ? "\n" : ""}${part.text ?? ""}`
	}

	return responseText
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildPromisePattern(promise: string): RegExp {
	return new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
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
		const lines = content.split("\n").filter((line: string) => line.trim())
		let lastAssistantLine: string | undefined

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { type?: string; timestamp?: string }
				if (entry.type === "user") continue
				if (startedAt && entry.timestamp && entry.timestamp < startedAt) continue
				if (entry.type === "assistant") {
					const parsed = entry as { type?: string; text?: string; content?: string }
					lastAssistantLine = parsed.text ?? parsed.content ?? ""
				}
				if (pattern.test(line)) return true
			} catch {
				continue
			}
		}

		const semanticSignal = detectSemanticCompletion(lastAssistantLine ?? "")
		if (semanticSignal) {
			log(`[${HOOK_NAME}] Semantic completion detected in transcript`, {
				signal: semanticSignal,
				transcriptPath,
			})
			return true
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
			const responseText = getAssistantMessageText(assistant)

			if (pattern.test(responseText)) {
				return true
			}
		}

		const latestAssistantMessage = assistantMessages[assistantMessages.length - 1]
		const semanticSignal = detectSemanticCompletion(getAssistantMessageText(latestAssistantMessage))
		if (semanticSignal) {
			log(`[${HOOK_NAME}] Semantic completion detected in session messages`, {
				sessionID: options.sessionID,
				signal: semanticSignal,
			})
			return true
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
