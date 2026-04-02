import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { buildVerificationFailurePrompt } from "./continuation-prompt-builder"
import { HOOK_NAME } from "./constants"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import type { RalphLoopState } from "./types"

type LoopStateController = {
	restartAfterFailedVerification: (
		sessionID: string,
		messageCountAtStart?: number,
	) => RalphLoopState | null
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
		log(`[${HOOK_NAME}] Failed to read parent session before verification retry`, {
			parentSessionID,
			error: String(error),
		})
		return false
	}

	if (state.verification_session_id) {
		ctx.client.session.abort({ path: { id: state.verification_session_id } }).catch(() => {})
	}

	const resumedState = loopState.restartAfterFailedVerification(
		parentSessionID,
		messageCountAtStart,
	)
	if (!resumedState) {
		log(`[${HOOK_NAME}] Failed to restart loop after verification failure`, {
			parentSessionID,
		})
		return false
	}

	await injectContinuationPrompt(ctx, {
		sessionID: parentSessionID,
		prompt: buildVerificationFailurePrompt(resumedState),
		directory,
		apiTimeoutMs,
	})

	await ctx.client.tui?.showToast?.({
		body: {
			title: "ULTRAWORK LOOP",
			message: "Oracle verification failed. Continuing ULTRAWORK loop.",
			variant: "warning",
			duration: 5000,
		},
	}).catch(() => {})

	return true
}
