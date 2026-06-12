import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"
import { buildVerificationFailurePrompt } from "./continuation-prompt-builder"
import { HOOK_NAME } from "./constants"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import type { IterationCommitExpectation, RalphLoopState } from "./types"

type LoopStateController = {
	clearVerificationState: (
		sessionID: string,
		messageCountAtStart?: number,
	) => RalphLoopState | null
	incrementIteration: (expected?: IterationCommitExpectation) => RalphLoopState | null
	clear: () => boolean
}

const ignoreBestEffortFailure = (): void => undefined

function showToastBestEffort(
	ctx: PluginInput,
	body: { title: string; message: string; variant: "warning" | "info"; duration: number },
): void {
	try {
		void Promise.resolve(ctx.client.tui?.showToast?.({ body })).catch(ignoreBestEffortFailure)
	} catch {
		ignoreBestEffortFailure()
	}
}

function getMessageCountFromResponse(messagesResponse: unknown): number {
	if (Array.isArray(messagesResponse)) {
		return messagesResponse.length
	}

	if (
		typeof messagesResponse === "object"
		&& messagesResponse !== null
		&& "data" in messagesResponse
	) {
		const data = (messagesResponse as { data?: unknown }).data
		return Array.isArray(data) ? data.length : 0
	}

	return 0
}

async function getSessionMessageCount(
	ctx: PluginInput,
	sessionID: string,
	directory: string,
): Promise<number> {
	const messagesResponse = await ctx.client.session.messages({
		path: { id: sessionID },
		query: { directory },
	})

	return getMessageCountFromResponse(messagesResponse)
}

export async function handleFailedVerification(
	ctx: PluginInput,
	input: {
		state: RalphLoopState
		directory: string
		apiTimeoutMs: number
		loopState: LoopStateController
	},
): Promise<boolean> {
	const { state, directory, apiTimeoutMs, loopState } = input
	const parentSessionID = state.session_id
	if (!parentSessionID) {
		return false
	}

	let messageCountAtStart: number
	try {
		messageCountAtStart = await getSessionMessageCount(ctx, parentSessionID, directory)
	} catch (error) {
		const errorText = error instanceof Error ? String(error) : String(error)
		log(`[${HOOK_NAME}] Failed to read parent session before verification retry`, {
			parentSessionID,
			error: errorText,
		})
		return false
	}

	const previewState: RalphLoopState = {
		...state,
		verification_pending: undefined,
		verification_session_id: undefined,
		message_count_at_start: messageCountAtStart,
		iteration: state.iteration + 1,
	}

	try {
		releasePromptAsyncReservation(parentSessionID, "ralph-loop:verification-failed", {
			reservedBy: HOOK_NAME,
		})
		const promptResult = await injectContinuationPrompt(ctx, {
			sessionID: parentSessionID,
			prompt: buildVerificationFailurePrompt(previewState),
			directory,
			apiTimeoutMs,
		})
		if (promptResult.status === "deferred") {
			log(`[${HOOK_NAME}] Deferred verification failure prompt`, {
				parentSessionID,
				reason: promptResult.reason,
			})
			return false
		}
		if (promptResult.status === "rejected") {
			log(`[${HOOK_NAME}] Failed to inject verification failure prompt`, {
				parentSessionID,
				error: String(promptResult.error),
			})
			loopState.clear()
			showToastBestEffort(ctx, {
				title: "Ralph Loop Failed",
				message: `Verification continuation rejected: ${String(promptResult.error)}`,
				variant: "warning",
				duration: 5000,
			})
			return false
		}
	} catch (error) {
		const errorText = error instanceof Error ? String(error) : String(error)
		log(`[${HOOK_NAME}] Failed to inject verification failure prompt`, {
			parentSessionID,
			error: errorText,
		})
		loopState.clear()
		showToastBestEffort(ctx, {
			title: "Ralph Loop Failed",
			message: `Verification continuation rejected: ${errorText}`,
			variant: "warning",
			duration: 5000,
		})
		return false
	}

	if (state.verification_session_id) {
		ctx.client.session.abort({ path: { id: state.verification_session_id } }).catch(ignoreBestEffortFailure)
	}

	const clearedState = loopState.clearVerificationState(
		parentSessionID,
		messageCountAtStart,
	)
	if (!clearedState) {
		log(`[${HOOK_NAME}] Failed to restart loop after verification failure`, {
			parentSessionID,
		})
		return false
	}

	const committed = loopState.incrementIteration({
		iteration: clearedState.iteration,
		sessionID: parentSessionID,
	})
	if (!committed) {
		log(`[${HOOK_NAME}] Failed to commit iteration after verification restart`, { parentSessionID })
		loopState.clear()
		showToastBestEffort(ctx, {
			title: "Ralph Loop Failed",
			message: "Verification continuation dispatched but iteration commit failed",
			variant: "warning",
			duration: 5000,
		})
		return false
	}

	await ctx.client.tui?.showToast?.({
		body: {
			title: "ULTRAWORK LOOP",
			message: "Oracle verification failed. Continuing ULTRAWORK loop.",
			variant: "warning",
			duration: 5000,
		},
	}).catch(ignoreBestEffortFailure)

	return true
}
