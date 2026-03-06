import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { RalphLoopOptions, RalphLoopState } from "./types"
import { HOOK_NAME } from "./constants"
import { handleDetectedCompletion } from "./completion-handler"
import {
	detectCompletionInSessionMessages,
	detectCompletionInTranscript,
} from "./completion-promise-detector"
import { continueIteration } from "./iteration-continuation"
import { handleDeletedLoopSession, handleErroredLoopSession } from "./session-event-handler"

type SessionRecovery = {
	isRecovering: (sessionID: string) => boolean
	markRecovering: (sessionID: string) => void
	clear: (sessionID: string) => void
}
type LoopStateController = {
	getState: () => RalphLoopState | null
	clear: () => boolean
	incrementIteration: () => RalphLoopState | null
	setSessionID: (sessionID: string) => RalphLoopState | null
	markVerificationPending: (sessionID: string) => RalphLoopState | null
}
type RalphLoopEventHandlerOptions = { directory: string; apiTimeoutMs: number; getTranscriptPath: (sessionID: string) => string | undefined; checkSessionExists?: RalphLoopOptions["checkSessionExists"]; sessionRecovery: SessionRecovery; loopState: LoopStateController }

export function createRalphLoopEventHandler(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
) {
	const inFlightSessions = new Set<string>()

	return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
		const props = event.properties as Record<string, unknown> | undefined

		if (event.type === "session.idle") {
			const sessionID = props?.sessionID as string | undefined
			if (!sessionID) return

			if (inFlightSessions.has(sessionID)) {
				log(`[${HOOK_NAME}] Skipped: handler in flight`, { sessionID })
				return
			}

			inFlightSessions.add(sessionID)

			try {

				if (options.sessionRecovery.isRecovering(sessionID)) {
					log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
					return
				}

				const state = options.loopState.getState()
				if (!state || !state.active) {
					return
				}

				if (state.session_id && state.session_id !== sessionID) {
					if (options.checkSessionExists) {
						try {
							const exists = await options.checkSessionExists(state.session_id)
							if (!exists) {
								options.loopState.clear()
								log(`[${HOOK_NAME}] Cleared orphaned state from deleted session`, {
									orphanedSessionId: state.session_id,
									currentSessionId: sessionID,
								})
								return
							}
						} catch (err) {
							log(`[${HOOK_NAME}] Failed to check session existence`, {
								sessionId: state.session_id,
								error: String(err),
							})
						}
					}
					return
				}

				const transcriptPath = options.getTranscriptPath(sessionID)
				const completionViaTranscript = detectCompletionInTranscript(
					transcriptPath,
					state.completion_promise,
					state.started_at,
				)
				const completionViaApi = completionViaTranscript
					? false
					: await detectCompletionInSessionMessages(ctx, {
						sessionID,
						promise: state.completion_promise,
						apiTimeoutMs: options.apiTimeoutMs,
						directory: options.directory,
						sinceMessageIndex: state.message_count_at_start,
					})

				if (completionViaTranscript || completionViaApi) {
					log(`[${HOOK_NAME}] Completion detected!`, {
						sessionID,
						iteration: state.iteration,
						promise: state.completion_promise,
						detectedVia: completionViaTranscript
							? "transcript_file"
							: "session_messages_api",
					})
					await handleDetectedCompletion(ctx, {
						sessionID,
						state,
						loopState: options.loopState,
						directory: options.directory,
						apiTimeoutMs: options.apiTimeoutMs,
					})
					return
				}

				if (
					typeof state.max_iterations === "number"
					&& state.iteration >= state.max_iterations
				) {
					log(`[${HOOK_NAME}] Max iterations reached`, {
						sessionID,
						iteration: state.iteration,
						max: state.max_iterations,
					})
					options.loopState.clear()

					await ctx.client.tui?.showToast?.({
						body: { title: "Ralph Loop Stopped", message: `Max iterations (${state.max_iterations}) reached without completion`, variant: "warning", duration: 5000 },
						}).catch(() => {})
					return
				}

				const newState = options.loopState.incrementIteration()
				if (!newState) {
					log(`[${HOOK_NAME}] Failed to increment iteration`, { sessionID })
					return
				}

				log(`[${HOOK_NAME}] Continuing loop`, {
					sessionID,
					iteration: newState.iteration,
					max: newState.max_iterations,
				})

				await ctx.client.tui?.showToast?.({
					body: {
						title: "Ralph Loop",
						message: `Iteration ${newState.iteration}/${typeof newState.max_iterations === "number" ? newState.max_iterations : "unbounded"}`,
						variant: "info",
						duration: 2000,
					},
					}).catch(() => {})

				try {
					await continueIteration(ctx, newState, {
						previousSessionID: sessionID,
						directory: options.directory,
						apiTimeoutMs: options.apiTimeoutMs,
						loopState: options.loopState,
					})
				} catch (err) {
					log(`[${HOOK_NAME}] Failed to inject continuation`, {
						sessionID,
						error: String(err),
					})
				}
				return
			} finally {
				inFlightSessions.delete(sessionID)
			}
		}

		if (event.type === "session.deleted") {
			if (!handleDeletedLoopSession(props, options.loopState, options.sessionRecovery)) return
			return
		}

		if (event.type === "session.error") {
			handleErroredLoopSession(props, options.loopState, options.sessionRecovery)
		}
	}
}
