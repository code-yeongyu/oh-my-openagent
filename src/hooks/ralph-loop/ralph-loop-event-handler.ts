import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { RalphLoopOptions, RalphLoopState } from "./types"
import { HOOK_NAME } from "./constants"
import {
	detectCompletionInSessionMessages,
	detectCompletionInTranscript,
} from "./completion-promise-detector"
import { continueIteration } from "./iteration-continuation"

type SessionRecovery = {
	isRecovering: (sessionID: string) => boolean
	markRecovering: (sessionID: string) => void
	clear: (sessionID: string) => void
}
type LoopStateController = {
	getState: (sessionID?: string) => RalphLoopState | null
	clear: (sessionID?: string) => boolean
	incrementIteration: (sessionID?: string) => RalphLoopState | null
	setSessionID: (sessionID: string) => RalphLoopState | null
	findAnyActiveState?: () => RalphLoopState | null
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

				let state = options.loopState.getState(sessionID)
				if (!state || !state.active) {
					const orphanedState = options.loopState.findAnyActiveState?.()
					if (orphanedState?.active && orphanedState.session_id && orphanedState.session_id !== sessionID) {
						if (options.checkSessionExists) {
							try {
								const exists = await options.checkSessionExists(orphanedState.session_id)
								if (!exists) {
									options.loopState.clear(orphanedState.session_id)
									log(`[${HOOK_NAME}] Cleared orphaned state from deleted session`, {
										orphanedSessionId: orphanedState.session_id,
										currentSessionId: sessionID,
									})
								}
							} catch (err) {
								log(`[${HOOK_NAME}] Failed to check session existence`, {
									sessionId: orphanedState.session_id,
									error: String(err),
								})
							}
						}
					}
					return
				}

				const transcriptPath = options.getTranscriptPath(sessionID)
				const completionViaTranscript = detectCompletionInTranscript(transcriptPath, state.completion_promise)
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
					options.loopState.clear(sessionID)

					const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Ralph Loop Complete!"
					const message = state.ultrawork ? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)` : `Task completed after ${state.iteration} iteration(s)`
					await ctx.client.tui?.showToast?.({ body: { title, message, variant: "success", duration: 5000 } }).catch(() => {})
					return
				}

				if (state.iteration >= state.max_iterations) {
					log(`[${HOOK_NAME}] Max iterations reached`, {
						sessionID,
						iteration: state.iteration,
						max: state.max_iterations,
					})
					options.loopState.clear(sessionID)

					await ctx.client.tui?.showToast?.({
						body: { title: "Ralph Loop Stopped", message: `Max iterations (${state.max_iterations}) reached without completion`, variant: "warning", duration: 5000 },
						}).catch(() => {})
					return
				}

				const newState = options.loopState.incrementIteration(sessionID)
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
						message: `Iteration ${newState.iteration}/${newState.max_iterations}`,
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
			const sessionInfo = props?.info as { id?: string } | undefined
			if (!sessionInfo?.id) return
			const state = options.loopState.getState(sessionInfo.id)
			if (state?.session_id === sessionInfo.id) {
				options.loopState.clear(sessionInfo.id)
				log(`[${HOOK_NAME}] Session deleted, loop cleared`, { sessionID: sessionInfo.id })
			}
			options.sessionRecovery.clear(sessionInfo.id)
			return
		}

		if (event.type === "session.error") {
			const sessionID = props?.sessionID as string | undefined
			const error = props?.error as { name?: string } | undefined

			if (error?.name === "MessageAbortedError") {
				if (sessionID) {
					const state = options.loopState.getState(sessionID)
					if (state?.session_id === sessionID) {
						options.loopState.clear(sessionID)
						log(`[${HOOK_NAME}] User aborted, loop cleared`, { sessionID })
					}
					options.sessionRecovery.clear(sessionID)
				}
				return
			}

			if (sessionID) {
				options.sessionRecovery.markRecovering(sessionID)
			}
		}
	}
}
