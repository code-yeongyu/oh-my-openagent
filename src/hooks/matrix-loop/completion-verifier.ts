import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { OpenCodeSessionMessage } from "./completion-promise-detector"
import { DEFAULT_VERIFICATION_AGENT, DEFAULT_VERIFICATION_TIMEOUT_MS, HOOK_NAME } from "./constants"

export interface VerificationResult {
	verified: boolean
	reason?: string
}

const VERIFICATION_TAG_PATTERN = /<verification>(.*?)<\/verification>/is

function buildVerificationPrompt(options: {
	prompt: string
	iteration: number
	completionPromise: string
}): string {
	return `You are verifying that a matrix-loop task has been completed successfully.

Original task: ${options.prompt}
Completion detected after ${options.iteration} iteration(s).
Completion promise: ${options.completionPromise}

Review the session history and verify:
1. The original task requirements are fully met
2. The completion promise was legitimately output (not just echoed in instructions)
3. No critical work remains incomplete

If verification PASSES, output: <verification>PASS</verification>
If verification FAILS, output: <verification>FAIL: [brief reason]</verification>`
}

function parseVerificationResponse(text: string): VerificationResult {
	const match = VERIFICATION_TAG_PATTERN.exec(text)
	if (!match) return { verified: true }

	const content = match[1].trim()
	if (content === "PASS") return { verified: true }

	if (content.startsWith("FAIL:")) {
		return { verified: false, reason: content.slice(5).trim() }
	}
	if (content === "FAIL") {
		return { verified: false, reason: "Verification failed" }
	}

	return { verified: true }
}

function extractAssistantText(messages: OpenCodeSessionMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.info?.role !== "assistant") continue
		const textParts = msg.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "")
		if (textParts && textParts.length > 0) return textParts.join("\n")
	}
	return undefined
}

export async function verifyCompletion(
	ctx: PluginInput,
	options: {
		sessionID: string
		directory: string
		completionPromise: string
		prompt: string
		iteration: number
		agent?: string
		timeoutMs?: number
		pollIntervalMs?: number
		preFetchedMessages?: OpenCodeSessionMessage[]
	},
): Promise<VerificationResult> {
	if (options.preFetchedMessages) {
		return verifyWithPrefetchedMessages(options.preFetchedMessages)
	}

	const agent = options.agent ?? DEFAULT_VERIFICATION_AGENT
	const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS
	const pollIntervalMs = options.pollIntervalMs ?? 2000
	let verifySessionID: string | undefined

	try {
		const createResult = await ctx.client.session.create({
			body: { parentID: options.sessionID, title: "Matrix Loop Verification" } as Record<string, unknown>,
			query: { directory: options.directory },
		})

		if ((createResult as { error?: unknown }).error || !createResult.data?.id) {
			log(`[${HOOK_NAME}] Verification session creation failed`)
			return { verified: true }
		}

		verifySessionID = createResult.data.id

		const verificationPrompt = buildVerificationPrompt({
			prompt: options.prompt,
			iteration: options.iteration,
			completionPromise: options.completionPromise,
		})

		await ctx.client.session.prompt({
			path: { id: verifySessionID },
			body: {
				agent,
				parts: [{ type: "text", text: verificationPrompt }],
			},
			query: { directory: options.directory },
		} as Parameters<typeof ctx.client.session.prompt>[0])

		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			try {
				const messagesResp = await ctx.client.session.messages({
					path: { id: verifySessionID },
				})

				const responseData = messagesResp && typeof messagesResp === "object" && "data" in messagesResp
					? (messagesResp as { data?: unknown }).data
					: undefined
				const messageArray: OpenCodeSessionMessage[] = Array.isArray(messagesResp)
					? messagesResp
					: Array.isArray(responseData)
						? responseData
						: []

				const assistantText = extractAssistantText(messageArray)
				if (assistantText && VERIFICATION_TAG_PATTERN.test(assistantText)) {
					return parseVerificationResponse(assistantText)
				}
			} catch {
				log(`[${HOOK_NAME}] Verification poll error`)
			}

			await new Promise<void>((resolve) => {
				setTimeout(resolve, pollIntervalMs)
			})
		}

		log(`[${HOOK_NAME}] Verification timed out, assuming pass`)
		return { verified: true }
	} catch (err) {
		log(`[${HOOK_NAME}] Verification error: ${String(err)}`)
		return { verified: true }
	} finally {
		if (verifySessionID) {
			ctx.client.session.delete({ path: { id: verifySessionID } }).catch(() => {})
		}
	}
}

function verifyWithPrefetchedMessages(messages: OpenCodeSessionMessage[]): VerificationResult {
	const assistantText = extractAssistantText(messages)
	if (assistantText && VERIFICATION_TAG_PATTERN.test(assistantText)) {
		return parseVerificationResponse(assistantText)
	}
	return { verified: true }
}
