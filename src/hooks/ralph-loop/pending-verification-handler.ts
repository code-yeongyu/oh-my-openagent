import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME, ULTRAWORK_VERIFICATION_PROMISE } from "./constants"
import { extractOracleSessionID, isOracleVerified } from "./oracle-verification-detector"
import type { RalphLoopState } from "./types"
import { handleFailedVerification } from "./verification-failure-handler"
import { withTimeout } from "./with-timeout"
import type { IterationCommitExpectation } from "./types"

export const STUCK_VERIFICATION_TIMEOUT_MS = 30 * 60 * 1000

type OpenCodeSessionMessage = {
	info?: { role?: string }
	parts?: Array<{ type?: string; text?: string }>
}

function collectAssistantText(message: OpenCodeSessionMessage): string {
	if (!Array.isArray(message.parts)) {
		return ""
	}

	const allowTextParts = message.info?.role === "assistant"
	let text = ""
	for (const part of message.parts) {
		if (part.type !== "tool_result" && !(allowTextParts && part.type === "text")) {
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

			const assistantText = collectAssistantText(message)
			if (!isOracleVerified(assistantText)) {
				continue
			}

			const detectedOracleSessionID = extractOracleSessionID(assistantText)
			if (detectedOracleSessionID) {
				return detectedOracleSessionID
			}
		}

		return undefined
	} catch (error) {
		const errorText = error instanceof Error ? String(error) : String(error)
		log(`[${HOOK_NAME}] Failed to scan parent session for oracle verification evidence`, {
			parentSessionID,
			error: errorText,
		})
		return undefined
	}
}

type LoopStateController = {
	restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
	clearVerificationState: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
	incrementIteration: (expected?: IterationCommitExpectation) => RalphLoopState | null
	clear: () => boolean
	setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null
}

function showCompletionToastBestEffort(ctx: PluginInput, state: RalphLoopState): void {
	const showToast = ctx.client.tui?.showToast
	if (!showToast) {
		return
	}

	const toastBody = {
		body: {
			title: "ULTRAWORK LOOP COMPLETE!",
			message: `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)`,
			variant: "success" as const,
			duration: 5000,
		},
	}
	const logToastError = (error: unknown) => {
		log(`[${HOOK_NAME}] Failed to show ulw completion toast`, {
			error: String(error),
		})
	}

	try {
		void Promise.resolve(showToast(toastBody)).catch(logToastError)
	} catch (error) {
		if (error instanceof Error) {
			logToastError(error)
			return
		}
		logToastError(error)
	}
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
				if (state.completion_promise === ULTRAWORK_VERIFICATION_PROMISE) {
					log(`[${HOOK_NAME}] Oracle verification evidence found in parent session, completing ultrawork loop`, {
						parentSessionID: state.session_id,
						recoveredVerificationSessionID,
					})
					loopState.clear()
					showCompletionToastBestEffort(ctx, state)
					return
				}

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

		if (state.verification_attempt_id && !state.verification_session_id) {
			const startedAt = state.verification_attempt_started_at
			const attemptAgeMs = startedAt !== undefined ? Date.now() - startedAt : undefined
			const isStuck = attemptAgeMs !== undefined && attemptAgeMs > STUCK_VERIFICATION_TIMEOUT_MS

			if (isStuck) {
				log(`[${HOOK_NAME}] Stuck oracle dispatch detected, proceeding to failure handler`, {
					sessionID,
					verificationAttemptId: state.verification_attempt_id,
					attemptAgeMs,
					iteration: state.iteration,
				})
			} else {
				log(`[${HOOK_NAME}] Skipped verification failure: oracle dispatch in flight`, {
					sessionID,
					verificationAttemptId: state.verification_attempt_id,
					iteration: state.iteration,
				})
				return
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
