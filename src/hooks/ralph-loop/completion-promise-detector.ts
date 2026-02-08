import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"

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
		const response = await Promise.race([
			ctx.client.session.messages({
				path: { id: options.sessionID },
				query: { directory: options.directory },
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("API timeout")), options.apiTimeoutMs),
			),
		])

		const messages = (response as { data?: unknown[] }).data ?? []
		if (!Array.isArray(messages)) return false

		const assistantMessages = (messages as OpenCodeSessionMessage[]).filter(
			(msg) => msg.info?.role === "assistant",
		)
		const lastAssistant = assistantMessages[assistantMessages.length - 1]
		if (!lastAssistant?.parts) return false

		const pattern = buildPromisePattern(options.promise)
		const responseText = lastAssistant.parts
			.filter((p) => p.type === "text")
			.map((p) => p.text ?? "")
			.join("\n")

		return pattern.test(responseText)
	} catch (err) {
		log(`[${HOOK_NAME}] Session messages check failed`, {
			sessionID: options.sessionID,
			error: String(err),
		})
		return false
	}
}
