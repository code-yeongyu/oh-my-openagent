import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { withTimeout } from "./with-timeout"

interface OpenCodeSessionMessage {
	info?: { role?: string }
	parts?: Array<{ type: string; text?: string }>
}

export async function countToolCallsInCurrentIteration(
	ctx: PluginInput,
	options: {
		sessionID: string
		apiTimeoutMs: number
		directory: string
	},
): Promise<number> {
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

		const messages = messageArray as OpenCodeSessionMessage[]
		let lastUserIndex = -1

		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].info?.role === "user") {
				lastUserIndex = i
				break
			}
		}

		let toolCallCount = 0
		const startIndex = lastUserIndex + 1

		for (let i = startIndex; i < messages.length; i++) {
			const message = messages[i]
			if (message.info?.role !== "assistant" || !message.parts) continue

			for (const part of message.parts) {
				if (part.type === "tool_use" || part.type === "tool_result") {
					toolCallCount++
				}
			}
		}

		return toolCallCount
	} catch (err) {
		setTimeout(() => {
			log(`[${HOOK_NAME}] Work verification check failed`, {
				sessionID: options.sessionID,
				error: String(err),
			})
		}, 0)
		return -1
	}
}
