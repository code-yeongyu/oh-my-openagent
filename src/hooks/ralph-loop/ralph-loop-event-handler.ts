import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
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

const RAPID_IDLE_DEDUP_MS = 500

type LoopStateController = {
	getState: () => RalphLoopState | null
	clear: () => boolean
	incrementIteration: () => RalphLoopState | null
	setSessionID: (sessionID: string) => RalphLoopState | null
	markVerificationPending: (sessionID: string) => RalphLoopState | null
	setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null
	restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
	clearVerificationState: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
}
type RalphLoopEventHandlerOptions = { directory: string; apiTimeoutMs: number; idleSettleMs: number; getTranscriptPath: (sessionID: string) => string | undefined; checkSessionExists?: RalphLoopOptions["checkSessionExists"]; backgroundManager?: RalphLoopOptions["backgroundManager"]; loopState: LoopStateController }

function sleep(ms: number): Promise<void> {
	return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function hasRunningBackgroundTasks(
	backgroundManager: RalphLoopOptions["backgroundManager"],
	sessionID: string,
): boolean {
	return backgroundManager
		? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running")
		: false
}

function getRuntimeRetryActivitySessionID(
	eventType: string,
	props: Record<string, unknown> | undefined,
): string | undefined {
	if (eventType === "message.updated") {
		const info = props?.info as Record<string, unknown> | undefined
		const role = info?.role
		return role === "assistant" ? resolveMessageEventSessionID(props) : undefined
	}

	if (eventType === "message.part.updated") {
		return resolveMessageEventSessionID(props)
	}

	if (eventType === "message.part.delta") {
		return resolveMessageEventSessionID(props)
	}

	if (eventType === "tool.execute.before" || eventType === "tool.execute.after") {
		return resolveMessageEventSessionID(props)
	}

	return undefined
}

function isSyntheticIdle(props: Record<string, unknown> | undefined): boolean {
	return props?.synthetic === true
}

function isAbortError(error: unknown): boolean {
	return typeof error === "object"
		&& error !== null
		&& "name" in error
		&& (error as { name?: unknown }).name === "MessageAbortedError"
}

function showToastBestEffort(
	ctx: PluginInput,
	body: { title: string; message: string; variant: "warning" | "info"; duration: number },
): void {
	try {
		void Promise.resolve(ctx.client.tui?.showToast?.({ body })).catch(() => {})
	} catch {
		return
	}
}

async function completionDetectedForState(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	sessionID: string,
	state: RalphLoopState,
	verificationSessionID: string | undefined,
): Promise<"transcript_file" | "session_messages_api" | null> {
	const completionSessionID = verificationSessionID ?? sessionID
	const transcriptPath = completionSessionID ? options.getTranscriptPath(completionSessionID) : undefined
	const completionViaTranscript = completionSessionID
		? detectCompletionInTranscript(
			transcriptPath,
			state.completion_promise,
			state.started_at,
		)
		: false
	if (completionViaTranscript) return "transcript_file"

	const completionViaApi = verificationSessionID
		? await detectCompletionInSessionMessages(ctx, {
			sessionID: verificationSessionID,
			promise: state.completion_promise,
			apiTimeoutMs: options.apiTimeoutMs,
			directory: options.directory,
			sinceMessageIndex: undefined,
		})
		: await detectCompletionInSessionMessages(ctx, {
			sessionID,
			promise: state.completion_promise,
			apiTimeoutMs: options.apiTimeoutMs,
			directory: options.directory,
			sinceMessageIndex: state.message_count_at_start,
		})

	return completionViaApi ? "session_messages_api" : null
}

async function handleCompletionIfDetected(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	input: {
		sessionID: string
		state: RalphLoopState
		verificationSessionID: string | undefined
		runtimeErrorRetriedSessions: Map<string, number>
	},
): Promise<boolean> {
	const detectedVia = await completionDetectedForState(
		ctx,
		options,
		input.sessionID,
		input.state,
		input.verificationSessionID,
	)
	if (!detectedVia) return false

	input.runtimeErrorRetriedSessions.delete(input.sessionID)
	log(`[${HOOK_NAME}] Completion detected!`, {
		sessionID: input.sessionID,
		iteration: input.state.iteration,
		promise: input.state.completion_promise,
		detectedVia,
	})
	await handleDetectedCompletion(ctx, {
		sessionID: input.sessionID,
		state: input.state,
		loopState: options.loopState,
		directory: options.directory,
		apiTimeoutMs: options.apiTimeoutMs,
	})
	return true
}

function showMaxIterationsToast(
	ctx: PluginInput,
	state: RalphLoopState,
): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop Stopped",
		message: `Max iterations (${state.max_iterations}) reached without completion`,
		variant: "warning",
		duration: 5000,
	})
}

function showIterationToast(
	ctx: PluginInput,
	state: RalphLoopState,
): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop",
		message: `Iteration ${state.iteration}/${typeof state.max_iterations === "number" ? state.max_iterations : "unbounded"}`,
		variant: "info",
		duration: 2000,
	})
}

export function createRalphLoopEventHandler(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
) {
	const inFlightSessions = new Set<string>()
	const runtimeErrorRetriedSessions = new Map<string, number>()
	const recentHandledSyntheticIdleAt = new Map<string, number>()

	return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
		const props = event.properties as Record<string, unknown> | undefined
		const runtimeRetryActivitySessionID = getRuntimeRetryActivitySessionID(event.type, props)
		if (runtimeRetryActivitySessionID) {
			runtimeErrorRetriedSessions.delete(runtimeRetryActivitySessionID)
			recentHandledSyntheticIdleAt.delete(runtimeRetryActivitySessionID)
		}

		if (event.type === "session.idle") {
			const sessionID = resolveSessionEventID(props)
			if (!sessionID) return
			const syntheticIdle = isSyntheticIdle(props)

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

				const lastHandledSyntheticIdleAt = recentHandledSyntheticIdleAt.get(sessionID)
				const now = Date.now()
				if (!syntheticIdle && lastHandledSyntheticIdleAt !== undefined && now - lastHandledSyntheticIdleAt < RAPID_IDLE_DEDUP_MS) {
					recentHandledSyntheticIdleAt.delete(sessionID)
					log(`[${HOOK_NAME}] Skipped: duplicate real idle after synthetic idle`, { sessionID })
					return
				}
				if (syntheticIdle) {
					recentHandledSyntheticIdleAt.set(sessionID, now)
				}

				if (await handleCompletionIfDetected(ctx, options, {
					sessionID,
					state,
					verificationSessionID,
					runtimeErrorRetriedSessions,
				})) {
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

					showMaxIterationsToast(ctx, state)
					return
				}

				await sleep(options.idleSettleMs)
				const stateAfterSettle = options.loopState.getState()
				if (!stateAfterSettle || !stateAfterSettle.active) {
					return
				}
				if (stateAfterSettle.session_id !== undefined && stateAfterSettle.session_id !== sessionID) {
					log(`[${HOOK_NAME}] Skipped: state rebound during settle window`, {
						sessionID,
						currentOwner: stateAfterSettle.session_id,
					})
					return
				}
				if (stateAfterSettle.verification_pending) {
					log(`[${HOOK_NAME}] Skipped: state entered verification_pending during settle window`, { sessionID })
					return
				}
				if (await handleCompletionIfDetected(ctx, options, {
					sessionID,
					state: stateAfterSettle,
					verificationSessionID: undefined,
					runtimeErrorRetriedSessions,
				})) {
					return
				}

				const nextIteration = stateAfterSettle.iteration + 1
				const previewState: RalphLoopState = { ...stateAfterSettle, iteration: nextIteration }

				log(`[${HOOK_NAME}] Continuing loop`, {
					sessionID,
					iteration: nextIteration,
					max: previewState.max_iterations,
				})

				const result = await continueIteration(ctx, previewState, {
					previousSessionID: sessionID,
					directory: options.directory,
					apiTimeoutMs: options.apiTimeoutMs,
					loopState: options.loopState,
				})

				if (result.status === "dispatched") {
					const stateBeforeCommit = options.loopState.getState()
					if (!stateBeforeCommit || !stateBeforeCommit.active) {
						return
					}
					if (await handleCompletionIfDetected(ctx, options, {
						sessionID,
						state: stateBeforeCommit,
						verificationSessionID: stateBeforeCommit.verification_pending
							? stateBeforeCommit.verification_session_id
							: undefined,
						runtimeErrorRetriedSessions,
					})) {
						return
					}

					const committed = options.loopState.incrementIteration()
					if (committed) {
						showIterationToast(ctx, committed)
					} else {
						log(`[${HOOK_NAME}] Dispatch succeeded but iteration commit failed`, { sessionID })
					}
					return
				}

				log(`[${HOOK_NAME}] Dispatch failed`, { sessionID, status: result.status })
				options.loopState.clear()
				showToastBestEffort(ctx, {
					title: "Ralph Loop Failed",
					message: result.status === "dispatch_rejected"
						? `Dispatch ${result.status}: ${String(result.error)}`
						: `Dispatch ${result.status}`,
					variant: "warning",
					duration: 5000,
				})
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
			const sessionID = resolveSessionEventID(props)
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
					showMaxIterationsToast(ctx, state)
					return
				}

				await sleep(options.idleSettleMs)
				const stateAfterSettle = options.loopState.getState()
				if (!stateAfterSettle || !stateAfterSettle.active) {
					return
				}
				if (stateAfterSettle.session_id !== undefined && stateAfterSettle.session_id !== sessionID) {
					log(`[${HOOK_NAME}] Skipped: state rebound during settle window`, {
						sessionID,
						currentOwner: stateAfterSettle.session_id,
					})
					return
				}
				if (stateAfterSettle.verification_pending) {
					log(`[${HOOK_NAME}] Skipped: state entered verification_pending during settle window`, { sessionID })
					return
				}
				if (await handleCompletionIfDetected(ctx, options, {
					sessionID,
					state: stateAfterSettle,
					verificationSessionID: undefined,
					runtimeErrorRetriedSessions,
				})) {
					return
				}

				const nextIteration = stateAfterSettle.iteration + 1
				const previewState: RalphLoopState = { ...stateAfterSettle, iteration: nextIteration }

				const result = await continueIteration(ctx, previewState, {
					previousSessionID: sessionID,
					directory: options.directory,
					apiTimeoutMs: options.apiTimeoutMs,
					loopState: options.loopState,
				})

				if (result.status === "dispatched") {
					const stateBeforeCommit = options.loopState.getState()
					if (!stateBeforeCommit || !stateBeforeCommit.active) {
						return
					}
					if (await handleCompletionIfDetected(ctx, options, {
						sessionID,
						state: stateBeforeCommit,
						verificationSessionID: stateBeforeCommit.verification_pending
							? stateBeforeCommit.verification_session_id
							: undefined,
						runtimeErrorRetriedSessions,
					})) {
						return
					}

					const committed = options.loopState.incrementIteration()
					if (committed) {
						showIterationToast(ctx, committed)
						runtimeErrorRetriedSessions.set(sessionID, committed.iteration)
					} else {
						log(`[${HOOK_NAME}] Dispatch succeeded but iteration commit failed after runtime error`, { sessionID })
					}
					return
				}

				log(`[${HOOK_NAME}] Dispatch failed after runtime error`, { sessionID, status: result.status })
				options.loopState.clear()
				showToastBestEffort(ctx, {
					title: "Ralph Loop Failed",
					message: result.status === "dispatch_rejected"
						? `Dispatch ${result.status}: ${String(result.error)}`
						: `Dispatch ${result.status}`,
					variant: "warning",
					duration: 5000,
				})
			} finally {
				inFlightSessions.delete(sessionID)
			}
		}
	}
}
