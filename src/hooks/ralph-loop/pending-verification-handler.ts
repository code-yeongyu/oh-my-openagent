import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"
import type { RalphLoopState } from "./types"
import { handleFailedVerification } from "./verification-failure-handler"
import { withTimeout } from "./with-timeout"

type OpenCodeSessionMessage = {
	info?: { role?: string }
	parts?: Array<{ type?: string; text?: string }>
}

const ORACLE_AGENT_PATTERN = /Agent:\s*oracle/i
const TASK_METADATA_SESSION_PATTERN = /<task_metadata>[\s\S]*?session_id:\s*([^\s<]+)[\s\S]*?<\/task_metadata>/i
const VERIFIED_PROMISE_PATTERN = new RegExp(
	`<promise>\\s*${ULTRAWORK_VERIFICATION_PROMISE}\\s*<\\/promise>`,
	"i",
)

function collectAssistantText(message: OpenCodeSessionMessage): string {
	if (!Array.isArray(message.parts)) {
		return ""
	}

	let text = ""
	for (const part of message.parts) {
		if (part.type !== "text" && part.type !== "tool_result") {
			continue
		}
		text += `${text ? "\n" : ""}${part.text ?? ""}`
	}

	return text
}

async function detectOracleVerificationFromParentSession(
	ctx: PluginInput,
	parentSessionID: string,
	directory: string,
	apiTimeoutMs: number,
): Promise<string | undefined> {
	try {
		const response = await withTimeout(
			ctx.client.session.messages({
				path: { id: parentSessionID },
				query: { directory },
			}),
			apiTimeoutMs,
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

		for (let index = messageArray.length - 1; index >= 0; index -= 1) {
			const message = messageArray[index] as OpenCodeSessionMessage
			if (message.info?.role !== "assistant") {
				continue
			}

			const assistantText = collectAssistantText(message)
			if (!VERIFIED_PROMISE_PATTERN.test(assistantText) || !ORACLE_AGENT_PATTERN.test(assistantText)) {
				continue
			}

			const sessionMatch = assistantText.match(TASK_METADATA_SESSION_PATTERN)
			const detectedOracleSessionID = sessionMatch?.[1]?.trim()
			if (detectedOracleSessionID) {
				return detectedOracleSessionID
			}
		}

		return undefined
	} catch (error) {
		log(`[${HOOK_NAME}] Failed to scan parent session for oracle verification evidence`, {
			parentSessionID,
			error: String(error),
		})
		return undefined
	}
}

type LoopStateController = {
	restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
	setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null
}

export async function handlePendingVerification(
	ctx: PluginInput,
	input: {
		sessionID: string
		state: RalphLoopState
		verificationSessionID?: string
		matchesParentSession: boolean
		matchesVerificationSession: boolean
		loopState: LoopStateController
		directory: string
		apiTimeoutMs: number
	},
): Promise<void> {
	const {
		sessionID,
		state,
		verificationSessionID,
		matchesParentSession,
		matchesVerificationSession,
		loopState,
		directory,
		apiTimeoutMs,
	} = input

	if (matchesParentSession || (verificationSessionID && matchesVerificationSession)) {
		if (!verificationSessionID && state.session_id) {
			const recoveredVerificationSessionID = await detectOracleVerificationFromParentSession(
				ctx,
				state.session_id,
				directory,
				apiTimeoutMs,
			)

			if (recoveredVerificationSessionID) {
				const updatedState = loopState.setVerificationSessionID(
					state.session_id,
					recoveredVerificationSessionID,
				)
				if (updatedState) {
					log(`[${HOOK_NAME}] Recovered missing verification session from parent evidence`, {
						parentSessionID: state.session_id,
						recoveredVerificationSessionID,
					})
					return
				}
			}
		}

		const restarted = await handleFailedVerification(ctx, {
			state,
			loopState,
			directory,
			apiTimeoutMs,
		})
		if (restarted) {
			return
		}
	}

	log(`[${HOOK_NAME}] Waiting for oracle verification`, {
		sessionID,
		verificationSessionID,
		iteration: state.iteration,
	})
}
