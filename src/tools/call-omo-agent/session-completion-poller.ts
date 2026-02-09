import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"

function getSessionStatusType(statusResult: unknown, sessionID: string): string | null {
	if (typeof statusResult !== "object" || statusResult === null) return null
	if (!("data" in statusResult)) return null
	const data = (statusResult as { data?: unknown }).data
	if (typeof data !== "object" || data === null) return null
	const record = data as Record<string, unknown>
	const entry = record[sessionID]
	if (typeof entry !== "object" || entry === null) return null
	const typeValue = (entry as Record<string, unknown>)["type"]
	return typeof typeValue === "string" ? typeValue : null
}

function getMessagesArray(result: unknown): unknown[] {
	if (Array.isArray(result)) return result
	if (typeof result !== "object" || result === null) return []
	if (!("data" in result)) return []
	const data = (result as { data?: unknown }).data
	return Array.isArray(data) ? data : []
}

export async function waitForSessionCompletion(
	ctx: PluginInput,
	options: {
		sessionID: string
		abortSignal?: AbortSignal
		maxPollTimeMs: number
		pollIntervalMs: number
		stabilityRequired: number
	},
): Promise<{ ok: true } | { ok: false; reason: "aborted" | "timeout" }> {
	const pollStart = Date.now()
	let lastMsgCount = 0
	let stablePolls = 0

	while (Date.now() - pollStart < options.maxPollTimeMs) {
		if (options.abortSignal?.aborted) {
			log("[call_omo_agent] Aborted by user")
			return { ok: false, reason: "aborted" }
		}

		await new Promise<void>((resolve) => {
			setTimeout(resolve, options.pollIntervalMs)
		})

		const statusResult = await ctx.client.session.status()
		const sessionStatusType = getSessionStatusType(statusResult, options.sessionID)

		if (sessionStatusType && sessionStatusType !== "idle") {
			stablePolls = 0
			lastMsgCount = 0
			continue
		}

		const messagesCheck = await ctx.client.session.messages({
			path: { id: options.sessionID },
		})
		const currentMsgCount = getMessagesArray(messagesCheck).length

		if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
			stablePolls++
			if (stablePolls >= options.stabilityRequired) {
				log("[call_omo_agent] Session complete", { messageCount: currentMsgCount })
				return { ok: true }
			}
		} else {
			stablePolls = 0
			lastMsgCount = currentMsgCount
		}
	}

	log("[call_omo_agent] Timeout reached")
	return { ok: false, reason: "timeout" }
}
