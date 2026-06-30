import type { PluginInput } from "@opencode-ai/plugin"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"
import { isRecord } from "../../shared/record-type-guard"
import { HOOK_NAME } from "./constants"
import {
	getRuntimeRetryActivitySessionID,
	isAbortError,
} from "./event-handler-activity"
import {
	getVerificationSessionID,
	handleIdleEvent,
	matchesLoopSession,
	type EventHandlerRuntime,
} from "./event-handler-idle"
import { handleRuntimeErrorEvent } from "./event-handler-runtime-error"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"
import {
	getPromptReservation,
	releasePromptAsyncReservation,
	reservationSourceMatches,
} from "../shared/prompt-async-gate"
import { handleDeletedLoopSession, handleErroredLoopSession } from "./session-event-handler"

const RALPH_LOOP_PROMPT_RESERVATION_SOURCE = "ralph-loop" as const
const RALPH_LOOP_PROMPT_RESERVATION_PREFIX = "ralph-loop:" as const

type RalphLoopEvent = {
	readonly type: string
	readonly properties?: unknown
}

function hasRalphOwnedPromptReservation(sessionID: string): boolean {
	const reservation = getPromptReservation(sessionID)
	return reservation !== undefined
		&& reservationSourceMatches(
			reservation.source,
			RALPH_LOOP_PROMPT_RESERVATION_SOURCE,
			RALPH_LOOP_PROMPT_RESERVATION_PREFIX,
		)
}

function releaseRalphPromptReservation(sessionID: string): void {
	releasePromptAsyncReservation(sessionID, RALPH_LOOP_PROMPT_RESERVATION_SOURCE, {
		reservedBy: RALPH_LOOP_PROMPT_RESERVATION_SOURCE,
		reservedByPrefix: RALPH_LOOP_PROMPT_RESERVATION_PREFIX,
	})
}

function clearRuntimeRetryActivity(
	runtime: EventHandlerRuntime,
	sessionID: string,
	options: { readonly releaseReservation: boolean },
): void {
	runtime.runtimeErrorRetriedSessions.delete(sessionID)
	if (options.releaseReservation) {
		releaseRalphPromptReservation(sessionID)
	}
	runtime.recentHandledSyntheticIdleAt.delete(sessionID)
}

function forgetNonLoopRuntimeRetryActivity(
	runtime: EventHandlerRuntime,
	sessionID: string,
): void {
	runtime.runtimeErrorRetriedSessions.delete(sessionID)
	runtime.recentHandledSyntheticIdleAt.delete(sessionID)
}

export function createRalphLoopEventHandlerImpl(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
) {
	const runtime: EventHandlerRuntime = {
		inFlightSessions: new Set<string>(),
		runtimeErrorRetriedSessions: new Map<string, number>(),
		recentHandledSyntheticIdleAt: new Map<string, number>(),
	}

	return async ({ event }: { readonly event: RalphLoopEvent }): Promise<void> => {
		const props = isRecord(event.properties) ? event.properties : undefined
		const runtimeRetryActivitySessionID = getRuntimeRetryActivitySessionID(event.type, props)
		if (runtimeRetryActivitySessionID) {
			const hasRuntimeRetryMarker = runtime.runtimeErrorRetriedSessions.has(runtimeRetryActivitySessionID)
			const hasRalphReservation = hasRalphOwnedPromptReservation(runtimeRetryActivitySessionID)
			if (!hasRuntimeRetryMarker && !hasRalphReservation) {
				return
			}

			const state = options.loopState.getState()
			if (!state?.active) {
				if (hasRuntimeRetryMarker || hasRalphReservation) {
					clearRuntimeRetryActivity(runtime, runtimeRetryActivitySessionID, {
						releaseReservation: hasRalphReservation,
					})
				}
				return
			}

			const verificationSessionID = getVerificationSessionID(state)
			const match = matchesLoopSession(state, runtimeRetryActivitySessionID, verificationSessionID)
			if (!match.parent && !match.verification) {
				forgetNonLoopRuntimeRetryActivity(runtime, runtimeRetryActivitySessionID)
				return
			}
			if (hasRuntimeRetryMarker) {
				clearRuntimeRetryActivity(runtime, runtimeRetryActivitySessionID, {
					releaseReservation: hasRalphReservation,
				})
			} else if (hasRalphReservation) {
				clearRuntimeRetryActivity(runtime, runtimeRetryActivitySessionID, {
					releaseReservation: true,
				})
			}
		}

		if (event.type === "session.idle") {
			const sessionID = resolveSessionEventID(props)
			if (!sessionID) return

			if (runtime.inFlightSessions.has(sessionID)) {
				log(`[${HOOK_NAME}] Skipped: handler in flight`, { sessionID })
				return
			}

			runtime.inFlightSessions.add(sessionID)
			try {
				await handleIdleEvent(ctx, options, runtime, props, sessionID)
			} finally {
				runtime.inFlightSessions.delete(sessionID)
			}
			return
		}

		if (event.type === "session.deleted") {
			handleDeletedLoopSession(props, options.loopState)
			return
		}

		if (event.type === "session.error") {
			const sessionID = resolveSessionEventID(props)
			const error = props?.error
			if (!sessionID || isAbortError(error)) {
				handleErroredLoopSession(props, options.loopState)
				return
			}

			if (runtime.inFlightSessions.has(sessionID)) {
				log(`[${HOOK_NAME}] Skipped runtime error retry: handler in flight`, { sessionID })
				return
			}

			runtime.inFlightSessions.add(sessionID)
			try {
				await handleRuntimeErrorEvent(ctx, options, runtime, props, sessionID)
			} finally {
				runtime.inFlightSessions.delete(sessionID)
			}
		}
	}
}
