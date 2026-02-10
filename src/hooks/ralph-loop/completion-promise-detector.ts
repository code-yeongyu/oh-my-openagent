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

export function detectCompletionInTranscript(
	transcriptPath: string | undefined,
	promise: string,
): boolean {
	if (!transcriptPath) return false

	try {
		if (!existsSync(transcriptPath)) return false

		const content = readFileSync(transcriptPath, "utf-8")
		const pattern = buildPromisePattern(promise)
		const lines = content.split("\n").filter((line) => line.trim())

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { type?: string }
				if (entry.type === "user") continue
				if (pattern.test(line)) return true
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

		const assistantMessages = (messageArray as OpenCodeSessionMessage[]).filter((msg) => msg.info?.role === "assistant")
		if (assistantMessages.length === 0) return false

		const pattern = buildPromisePattern(options.promise)
		const recentAssistants = assistantMessages.slice(-3)
		for (const assistant of recentAssistants) {
			if (!assistant.parts) continue

			let responseText = ""
			for (const part of assistant.parts) {
				if (part.type !== "text") continue
				responseText += `${responseText ? "\n" : ""}${part.text ?? ""}`
			}

			if (pattern.test(responseText)) {
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
