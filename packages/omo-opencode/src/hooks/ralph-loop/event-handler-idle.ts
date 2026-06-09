import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import type { RalphLoopState } from "./types"
import { handlePendingVerification } from "./pending-verification-handler"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"
import {
	hasActiveBackgroundTasks,
	isSyntheticIdle,
	RAPID_IDLE_DEDUP_MS,
} from "./event-handler-activity"
import { handleCompletionIfDetected } from "./event-handler-completion"
import {
	continueSettledIteration,
	stopIfLatestAssistantMadeNoProgress,
} from "./event-handler-continuation"
import { showMaxIterationsToast } from "./event-handler-feedback"

export type EventHandlerRuntime = {
	readonly inFlightSessions: Set<string>
	readonly runtimeErrorRetriedSessions: Map<string, number>
	readonly recentHandledSyntheticIdleAt: Map<string, number>
}

export function getVerificationSessionID(state: RalphLoopState): string | undefined {
	return state.verification_pending
		? state.verification_session_id
		: undefined
}

export function matchesLoopSession(
	state: RalphLoopState,
	sessionID: string,
	verificationSessionID: string | undefined,
): { readonly parent: boolean; readonly verification: boolean } {
	return {
		parent: state.session_id === undefined || state.session_id === sessionID,
		verification: verificationSessionID === sessionID,
	}
}

export function maxIterationsReached(state: RalphLoopState): boolean {
	return typeof state.max_iterations === "number"
		&& state.iteration >= state.max_iterations
}

async function clearOrphanedStateIfNeeded(
	options: RalphLoopEventHandlerOptions,
	state: RalphLoopState,
	sessionID: string,
): Promise<boolean> {
	if (!state.session_id || !options.checkSessionExists) {
		return false
	}

	try {
		const exists = await options.checkSessionExists(state.session_id)
		if (exists) return false
		options.loopState.clear()
		log(`[${HOOK_NAME}] Cleared orphaned state from deleted session`, {
			orphanedSessionId: state.session_id,
			currentSessionId: sessionID,
		})
		return true
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log(`[${HOOK_NAME}] Failed to check session existence`, {
			sessionId: state.session_id,
			error: message,
		})
		return false
	}
}

function shouldSkipRapidRealIdle(
	runtime: EventHandlerRuntime,
	sessionID: string,
	syntheticIdle: boolean,
	now: number,
): boolean {
	const lastHandledSyntheticIdleAt = runtime.recentHandledSyntheticIdleAt.get(sessionID)
	if (!syntheticIdle && lastHandledSyntheticIdleAt !== undefined && now - lastHandledSyntheticIdleAt < RAPID_IDLE_DEDUP_MS) {
		runtime.recentHandledSyntheticIdleAt.delete(sessionID)
		log(`[${HOOK_NAME}] Skipped: duplicate real idle after synthetic idle`, { sessionID })
		return true
	}
	if (syntheticIdle) {
		runtime.recentHandledSyntheticIdleAt.set(sessionID, now)
	}
	return false
}

export async function handleIdleEvent(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	runtime: EventHandlerRuntime,
	props: Record<string, unknown> | undefined,
	sessionID: string,
): Promise<void> {
	const state = options.loopState.getState()
	if (!state || !state.active) {
		return
	}

	if (hasActiveBackgroundTasks(options.backgroundManager, sessionID)) {
		log(`[${HOOK_NAME}] Skipped: background tasks active`, { sessionID })
		return
	}

	const verificationSessionID = getVerificationSessionID(state)
	const matchesSession = matchesLoopSession(state, sessionID, verificationSessionID)

	if (!matchesSession.parent && !matchesSession.verification && state.session_id) {
		await clearOrphanedStateIfNeeded(options, state, sessionID)
		return
	}

	if (shouldSkipRapidRealIdle(runtime, sessionID, isSyntheticIdle(props), Date.now())) {
		return
	}

	if (await handleCompletionIfDetected(ctx, options, {
		sessionID,
		state,
		verificationSessionID,
		runtimeErrorRetriedSessions: runtime.runtimeErrorRetriedSessions,
	})) {
		return
	}

	if (await stopIfLatestAssistantMadeNoProgress(ctx, options, { sessionID, state })) {
		return
	}

	if (state.verification_pending) {
		if (!verificationSessionID && matchesSession.parent) {
			log(`[${HOOK_NAME}] Verification pending without tracked oracle session, running recovery check`, {
				sessionID,
				iteration: state.iteration,
			})
		}

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

	if (runtime.runtimeErrorRetriedSessions.get(sessionID) === state.iteration) {
		runtime.runtimeErrorRetriedSessions.delete(sessionID)
		log(`[${HOOK_NAME}] Skipped stale idle after runtime error retry`, {
			sessionID,
			iteration: state.iteration,
		})
		return
	}

	if (maxIterationsReached(state)) {
		log(`[${HOOK_NAME}] Max iterations reached`, {
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
		afterRuntimeError: false,
	})
}
