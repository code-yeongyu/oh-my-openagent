import type { PluginInput } from "@opencode-ai/plugin"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"
import { isRecord } from "../../shared/record-type-guard"
import { HOOK_NAME } from "./constants"
import {
	getRuntimeRetryActivitySessionID,
	isAbortError,
} from "./event-handler-activity"
import { handleIdleEvent, type EventHandlerRuntime } from "./event-handler-idle"
import { handleRuntimeErrorEvent } from "./event-handler-runtime-error"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"
import { handleDeletedLoopSession, handleErroredLoopSession } from "./session-event-handler"

type RalphLoopEvent = {
	readonly type: string
	readonly properties?: unknown
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
			runtime.runtimeErrorRetriedSessions.delete(runtimeRetryActivitySessionID)
			releasePromptAsyncReservation(runtimeRetryActivitySessionID, "ralph-loop", {
				supersedeTransientRetryOwners: true,
			})
			runtime.recentHandledSyntheticIdleAt.delete(runtimeRetryActivitySessionID)
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
