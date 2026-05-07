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
import { handlePendingVerification } from "./pending-verification-handler"
import { handleDeletedLoopSession, handleErroredLoopSession } from "./session-event-handler"

type LoopStateController = {
	getState: () => RalphLoopState | null
	clear: () => boolean
	incrementIteration: () => RalphLoopState | null
	setSessionID: (sessionID: string) => RalphLoopState | null
	markVerificationPending: (sessionID: string) => RalphLoopState | null
	setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null
	restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
}
type RalphLoopEventHandlerOptions = { directory: string; apiTimeoutMs: number; getTranscriptPath: (sessionID: string) => string | undefined; checkSessionExists?: RalphLoopOptions["checkSessionExists"]; backgroundManager?: RalphLoopOptions["backgroundManager"]; loopState: LoopStateController }

function hasRunningBackgroundTasks(
	backgroundManager: RalphLoopOptions["backgroundManager"],
	sessionID: string,
): boolean {
	return backgroundManager
		? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running")
		: false
}

function getInfoSessionID(props: Record<string, unknown> | undefined): string | undefined {
	const info = props?.info as Record<string, unknown> | undefined
	const sessionID = info?.sessionID
	return typeof sessionID === "string" ? sessionID : undefined
}

function getRuntimeRetryActivitySessionID(
	eventType: string,
	props: Record<string, unknown> | undefined,
): string | undefined {
	if (eventType === "message.updated") {
		const info = props?.info as Record<string, unknown> | undefined
		const role = info?.role
		return role === "assistant" ? getInfoSessionID(props) : undefined
	}

	if (eventType === "message.part.updated") {
		if (typeof props?.sessionID === "string") return props.sessionID
		return getInfoSessionID(props)
	}

	if (eventType === "message.part.delta") {
		return typeof props?.sessionID === "string" ? props.sessionID : undefined
	}

	if (eventType === "tool.execute.before" || eventType === "tool.execute.after") {
		return typeof props?.sessionID === "string" ? props.sessionID : undefined
	}

	return undefined
}

function isAbortError(error: unknown): boolean {
	return typeof error === "object"
		&& error !== null
		&& "name" in error
		&& (error as { name?: unknown }).name === "MessageAbortedError"
}

async function showMaxIterationsToast(
	ctx: PluginInput,
	state: RalphLoopState,
): Promise<void> {
	await ctx.client.tui?.showToast?.({
		body: { title: "Ralph Loop Stopped", message: `Max iterations (${state.max_iterations}) reached without completion`, variant: "warning", duration: 5000 },
	}).catch(() => {})
}

async function showIterationToast(
	ctx: PluginInput,
	state: RalphLoopState,
): Promise<void> {
	await ctx.client.tui?.showToast?.({
		body: {
			title: "Ralph Loop",
			message: `Iteration ${state.iteration}/${typeof state.max_iterations === "number" ? state.max_iterations : "unbounded"}`,
			variant: "info",
			duration: 2000,
		},
	}).catch(() => {})
}

export function createRalphLoopEventHandler(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
) {
	const inFlightSessions = new Set<string>()
	const runtimeErrorRetriedSessions = new Map<string, number>()

	return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
		const props = event.properties as Record<string, unknown> | undefined
		const runtimeRetryActivitySessionID = getRuntimeRetryActivitySessionID(event.type, props)
		if (runtimeRetryActivitySessionID) {
			runtimeErrorRetriedSessions.delete(runtimeRetryActivitySessionID)
		}

		if (event.type === "session.idle") {
			const sessionID = props?.sessionID as string | undefined
			if (!sessionID) return

			if (inFlightSessions.has(sessionID)) {
				log(`[${HOOK_NAME}] Skipped: handler in flight`, { sessionID })
				return
			}

			inFlightSessions.add(sessionID)

			try {
				const state = options.loopState.getState()
					if (!state || !state.active) {
						return
					}

					if (hasRunningBackgroundTasks(options.backgroundManager, sessionID)) {
						log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
						return
					}

				const verificationSessionID = state.verification_pending
					? state.verification_session_id
					: undefined
				const matchesParentSession = state.session_id === undefined || state.session_id === sessionID
				const matchesVerificationSession = verificationSessionID === sessionID

				if (!matchesParentSession && !matchesVerificationSession && state.session_id) {
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

				const completionSessionID = verificationSessionID ?? sessionID
				const transcriptPath = completionSessionID ? options.getTranscriptPath(completionSessionID) : undefined
				const completionViaTranscript = completionSessionID
					? detectCompletionInTranscript(
						transcriptPath,
						state.completion_promise,
						state.started_at,
					)
					: false
				const completionViaApi = completionViaTranscript
					? false
					: verificationSessionID
						? await detectCompletionInSessionMessages(ctx, {
							sessionID: verificationSessionID,
							promise: state.completion_promise,
							apiTimeoutMs: options.apiTimeoutMs,
							directory: options.directory,
							sinceMessageIndex: undefined,
						})
					: state.verification_pending
						? await detectCompletionInSessionMessages(ctx, {
							sessionID,
							promise: state.completion_promise,
							apiTimeoutMs: options.apiTimeoutMs,
							directory: options.directory,
							sinceMessageIndex: state.message_count_at_start,
						})
					: await detectCompletionInSessionMessages(ctx, {
						sessionID,
						promise: state.completion_promise,
						apiTimeoutMs: options.apiTimeoutMs,
						directory: options.directory,
						sinceMessageIndex: state.message_count_at_start,
					})

				if (completionViaTranscript || completionViaApi) {
					runtimeErrorRetriedSessions.delete(sessionID)
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

				if (state.verification_pending) {
					if (!verificationSessionID && matchesParentSession) {
						log(`[${HOOK_NAME}] Verification pending without tracked oracle session, running recovery check`, {
							sessionID,
							iteration: state.iteration,
						})
					}

					await handlePendingVerification(ctx, {
						sessionID,
						state,
						verificationSessionID,
						matchesParentSession,
						matchesVerificationSession,
						loopState: options.loopState,
						directory: options.directory,
						apiTimeoutMs: options.apiTimeoutMs,
					})
					return
				}

				if (runtimeErrorRetriedSessions.get(sessionID) === state.iteration) {
					runtimeErrorRetriedSessions.delete(sessionID)
					log(`[${HOOK_NAME}] Skipped stale idle after runtime error retry`, {
						sessionID,
						iteration: state.iteration,
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

					await showMaxIterationsToast(ctx, state)
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

				await showIterationToast(ctx, newState)

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
			if (!handleDeletedLoopSession(props, options.loopState)) return
			return
		}

		if (event.type === "session.error") {
			const sessionID = props?.sessionID as string | undefined
			const error = props?.error
			if (!sessionID || isAbortError(error)) {
				handleErroredLoopSession(props, options.loopState)
				return
			}

			if (inFlightSessions.has(sessionID)) {
				log(`[${HOOK_NAME}] Skipped runtime error retry: handler in flight`, { sessionID })
				return
			}

			inFlightSessions.add(sessionID)
			try {
				const state = options.loopState.getState()
				if (!state || !state.active) {
					handleErroredLoopSession(props, options.loopState)
					return
				}

				const verificationSessionID = state.verification_pending
					? state.verification_session_id
					: undefined
					const matchesParentSession = state.session_id === undefined || state.session_id === sessionID
					const matchesVerificationSession = verificationSessionID === sessionID
					if (!matchesParentSession && !matchesVerificationSession) {
						handleErroredLoopSession(props, options.loopState)
						return
					}

					if (hasRunningBackgroundTasks(options.backgroundManager, sessionID)) {
						log(`[${HOOK_NAME}] Skipped runtime error retry: background tasks running`, { sessionID })
						return
					}

					log(`[${HOOK_NAME}] Retrying after runtime session error`, {
						sessionID,
						iteration: state.iteration,
						error: String(error),
					})

				if (state.verification_pending) {
					await handlePendingVerification(ctx, {
						sessionID,
						state,
						verificationSessionID,
						matchesParentSession,
						matchesVerificationSession,
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
					log(`[${HOOK_NAME}] Runtime error retry budget exhausted`, {
						sessionID,
						iteration: state.iteration,
						max: state.max_iterations,
					})
					options.loopState.clear()
					await showMaxIterationsToast(ctx, state)
					return
				}

				const newState = options.loopState.incrementIteration()
				if (!newState) {
					log(`[${HOOK_NAME}] Failed to increment iteration after runtime error`, { sessionID })
					return
				}

				await showIterationToast(ctx, newState)
				try {
					await continueIteration(ctx, newState, {
						previousSessionID: sessionID,
						directory: options.directory,
						apiTimeoutMs: options.apiTimeoutMs,
						loopState: options.loopState,
					})
					runtimeErrorRetriedSessions.set(sessionID, newState.iteration)
				} catch (err) {
					log(`[${HOOK_NAME}] Failed to retry after runtime error`, {
						sessionID,
						error: String(err),
					})
				}
			} finally {
				inFlightSessions.delete(sessionID)
			}
		}
	}
}
