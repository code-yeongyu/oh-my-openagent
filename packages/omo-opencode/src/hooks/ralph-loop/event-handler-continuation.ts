import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { isSessionActive } from "../shared/session-idle-settle"
import { HOOK_NAME } from "./constants"
import { continueIteration } from "./iteration-continuation"
import { latestAssistantTurnMadeNoProgress } from "./no-progress-turn-detector"
import type { RalphLoopState } from "./types"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"
import { handleCompletionIfDetected } from "./event-handler-completion"
import {
	latestUserMessageIsInProgress,
	sleep,
} from "./event-handler-activity"
import {
	showDispatchFailureToast,
	showIterationCommitFailureToast,
	showIterationToast,
	showNoProgressToast,
} from "./event-handler-feedback"

type ContinueSettledIterationInput = {
	readonly sessionID: string
	readonly state: RalphLoopState
	readonly runtimeErrorRetriedSessions: Map<string, number>
	readonly afterRuntimeError: boolean
}

export async function stopIfLatestAssistantMadeNoProgress(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	input: {
		readonly sessionID: string
		readonly state: RalphLoopState
		readonly afterRuntimeError?: boolean
	},
): Promise<boolean> {
	if (!await latestAssistantTurnMadeNoProgress(ctx, {
		sessionID: input.sessionID,
		directory: options.directory,
		apiTimeoutMs: options.apiTimeoutMs,
		sinceMessageIndex: input.state.message_count_at_start,
	})) {
		return false
	}

	log(
		input.afterRuntimeError
			? `[${HOOK_NAME}] Stopped after no-progress assistant turn following runtime error`
			: `[${HOOK_NAME}] Stopped after no-progress assistant turn`,
		{
			sessionID: input.sessionID,
			iteration: input.state.iteration,
		},
	)
	options.loopState.clear()
	showNoProgressToast(ctx)
	return true
}

export async function continueSettledIteration(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	input: ContinueSettledIterationInput,
): Promise<void> {
	await sleep(options.idleSettleMs)
	const stateAfterSettle = options.loopState.getState()
	if (!stateAfterSettle || !stateAfterSettle.active) {
		return
	}
	if (stateAfterSettle.session_id !== undefined && stateAfterSettle.session_id !== input.sessionID) {
		log(`[${HOOK_NAME}] Skipped: state rebound during settle window`, {
			sessionID: input.sessionID,
			currentOwner: stateAfterSettle.session_id,
		})
		return
	}
	if (await isSessionActive(ctx.client, input.sessionID)) {
		log(`[${HOOK_NAME}] Skipped: session became active during settle window`, { sessionID: input.sessionID })
		return
	}
	if (await latestUserMessageIsInProgress(ctx, options, input.sessionID, Date.now())) {
		log(
			input.afterRuntimeError
				? `[${HOOK_NAME}] Skipped: recent user message is still in progress after runtime error`
				: `[${HOOK_NAME}] Skipped: recent user message is still in progress`,
			{ sessionID: input.sessionID },
		)
		return
	}
	if (stateAfterSettle.verification_pending) {
		log(`[${HOOK_NAME}] Skipped: state entered verification_pending during settle window`, { sessionID: input.sessionID })
		return
	}
	if (await handleCompletionIfDetected(ctx, options, {
		sessionID: input.sessionID,
		state: stateAfterSettle,
		verificationSessionID: undefined,
		runtimeErrorRetriedSessions: input.runtimeErrorRetriedSessions,
	})) {
		return
	}

	if (await stopIfLatestAssistantMadeNoProgress(ctx, options, {
		sessionID: input.sessionID,
		state: stateAfterSettle,
		afterRuntimeError: input.afterRuntimeError,
	})) {
		return
	}

	const nextIteration = stateAfterSettle.iteration + 1
	const previewState: RalphLoopState = { ...stateAfterSettle, iteration: nextIteration }

	if (!input.afterRuntimeError) {
		log(`[${HOOK_NAME}] Continuing loop`, {
			sessionID: input.sessionID,
			iteration: nextIteration,
			max: previewState.max_iterations,
		})
	}

	const result = await continueIteration(ctx, previewState, {
		previousSessionID: input.sessionID,
		directory: options.directory,
		apiTimeoutMs: options.apiTimeoutMs,
		idleSettleMs: options.idleSettleMs,
		loopState: options.loopState,
	})

	if (result.status === "dispatched") {
		const stateBeforeCommit = options.loopState.getState()
		if (!stateBeforeCommit || !stateBeforeCommit.active) {
			return
		}
		if (await handleCompletionIfDetected(ctx, options, {
			sessionID: input.sessionID,
			state: stateBeforeCommit,
			verificationSessionID: stateBeforeCommit.verification_pending
				? stateBeforeCommit.verification_session_id
				: undefined,
			runtimeErrorRetriedSessions: input.runtimeErrorRetriedSessions,
		})) {
			return
		}

		const committed = options.loopState.incrementIteration({
			iteration: stateBeforeCommit.iteration,
			sessionID: result.sessionID,
		})
		if (committed) {
			showIterationToast(ctx, committed)
			if (input.afterRuntimeError) {
				input.runtimeErrorRetriedSessions.set(input.sessionID, committed.iteration)
			}
		} else {
			log(
				input.afterRuntimeError
					? `[${HOOK_NAME}] Dispatch succeeded but iteration commit failed after runtime error`
					: `[${HOOK_NAME}] Dispatch succeeded but iteration commit failed`,
				{ sessionID: input.sessionID },
			)
			options.loopState.clear()
			showIterationCommitFailureToast(ctx)
		}
		return
	}
	if (result.status === "dispatch_deferred") {
		log(
			input.afterRuntimeError
				? `[${HOOK_NAME}] Dispatch deferred after runtime error`
				: `[${HOOK_NAME}] Dispatch deferred`,
			{ sessionID: input.sessionID, reason: result.reason },
		)
		return
	}

	log(
		input.afterRuntimeError
			? `[${HOOK_NAME}] Dispatch failed after runtime error`
			: `[${HOOK_NAME}] Dispatch failed`,
		{ sessionID: input.sessionID, status: result.status },
	)
	options.loopState.clear()
	showDispatchFailureToast(ctx, result)
}
