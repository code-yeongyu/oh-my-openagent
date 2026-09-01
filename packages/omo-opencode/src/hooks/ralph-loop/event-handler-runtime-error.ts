import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import {
	hasActiveBackgroundTasks,
} from "./event-handler-activity"
import {
	continueSettledIteration,
} from "./event-handler-continuation"
import { showMaxIterationsToast } from "./event-handler-feedback"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"
import {
	getVerificationSessionID,
	maxIterationsReached,
	matchesLoopSession,
	type EventHandlerRuntime,
} from "./event-handler-idle"
import { handlePendingVerification } from "./pending-verification-handler"
import { handleErroredLoopSession } from "./session-event-handler"

export async function handleRuntimeErrorEvent(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	runtime: EventHandlerRuntime,
	props: Record<string, unknown> | undefined,
	sessionID: string,
): Promise<void> {
	const state = options.loopState.getState()
	if (!state || !state.active) {
		handleErroredLoopSession(props, options.loopState)
		return
	}

	const verificationSessionID = getVerificationSessionID(state)
	const matchesSession = matchesLoopSession(state, sessionID, verificationSessionID)
	if (!matchesSession.parent && !matchesSession.verification) {
		handleErroredLoopSession(props, options.loopState)
		return
	}

	if (hasActiveBackgroundTasks(options.backgroundManager, sessionID)) {
		log(`[${HOOK_NAME}] Skipped runtime error retry: background tasks active`, { sessionID })
		return
	}

	log(`[${HOOK_NAME}] Retrying after runtime session error`, {
		sessionID,
		iteration: state.iteration,
		error: String(props?.error),
	})

	if (state.verification_pending) {
		await handlePendingVerification(ctx, {
			sessionID,
			state,
			verificationSessionID,
			matchesParentSession: matchesSession.parent,
			matchesVerificationSession: matchesSession.verification,
			loopState: options.loopState,
			directory: options.directory,
			apiTimeoutMs: options.apiTimeoutMs,
		})
		return
	}

	if (maxIterationsReached(state)) {
		log(`[${HOOK_NAME}] Runtime error retry budget exhausted`, {
			sessionID,
			iteration: state.iteration,
			max: state.max_iterations,
		})
		options.loopState.clear()
		showMaxIterationsToast(ctx, state)
		return
	}

	await continueSettledIteration(ctx, options, {
		sessionID,
		state,
		runtimeErrorRetriedSessions: runtime.runtimeErrorRetriedSessions,
		afterRuntimeError: true,
	})
}
