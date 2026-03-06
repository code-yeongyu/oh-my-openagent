import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { HOOK_NAME } from "./constants"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import type { RalphLoopState } from "./types"

type LoopStateController = {
	clear: () => boolean
	markVerificationPending: (sessionID: string) => RalphLoopState | null
}

export async function handleDetectedCompletion(
	ctx: PluginInput,
	input: {
		sessionID: string
		state: RalphLoopState
		loopState: LoopStateController
		directory: string
		apiTimeoutMs: number
	},
): Promise<void> {
	const { sessionID, state, loopState, directory, apiTimeoutMs } = input

	if (state.ultrawork && !state.verification_pending) {
		const verificationState = loopState.markVerificationPending(sessionID)
		if (!verificationState) {
			log(`[${HOOK_NAME}] Failed to transition ultrawork loop to verification`, {
				sessionID,
			})
			return
		}

		await injectContinuationPrompt(ctx, {
			sessionID,
			prompt: buildContinuationPrompt(verificationState),
			directory,
			apiTimeoutMs,
		})

		await ctx.client.tui?.showToast?.({
			body: {
				title: "ULTRAWORK LOOP",
				message: "DONE detected. Oracle verification is now required.",
				variant: "info",
				duration: 5000,
			},
		}).catch(() => {})
		return
	}

	loopState.clear()

	const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Ralph Loop Complete!"
	const message = state.ultrawork
		? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)`
		: `Task completed after ${state.iteration} iteration(s)`
	await ctx.client.tui?.showToast?.({
		body: { title, message, variant: "success", duration: 5000 },
	}).catch(() => {})
}
