import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { HOOK_NAME } from "./constants"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import type { RalphLoopState } from "./types"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"

type LoopStateController = {
	clear: () => boolean
	markVerificationPending: (sessionID: string) => RalphLoopState | null
}

const ignoreBestEffortFailure = (): void => undefined

function showToastBestEffort(
	ctx: PluginInput,
	body: { title: string; message: string; variant: "error" | "info" | "success"; duration: number },
): void {
	try {
		void Promise.resolve(ctx.client.tui?.showToast?.({ body })).catch(ignoreBestEffortFailure)
	} catch {
		ignoreBestEffortFailure()
	}
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
		if (state.verification_session_id) {
			ctx.client.session.abort({ path: { id: state.verification_session_id } }).catch(ignoreBestEffortFailure)
		}

		const verificationState = loopState.markVerificationPending(sessionID)
		if (!verificationState) {
			log(`[${HOOK_NAME}] Failed to transition ultrawork loop to verification`, {
				sessionID,
			})
			return
		}

		releasePromptAsyncReservation(sessionID, "ralph-loop:completion-detected", {
			reservedBy: HOOK_NAME,
		})
		const promptResult = await injectContinuationPrompt(ctx, {
			sessionID,
			prompt: buildContinuationPrompt(verificationState),
			directory,
			apiTimeoutMs,
		})
		if (promptResult.status === "deferred") {
			log(`[${HOOK_NAME}] Deferred ultrawork verification prompt`, {
				sessionID,
				reason: promptResult.reason,
			})
			return
		}
		if (promptResult.status === "rejected") {
			log(`[${HOOK_NAME}] Failed to inject ultrawork verification prompt`, {
				sessionID,
				error: String(promptResult.error),
			})
			loopState.clear()
			showToastBestEffort(ctx, {
				title: "Ralph Loop Failed",
				message: `Verification dispatch rejected: ${String(promptResult.error)}`,
				variant: "error",
				duration: 5000,
			})
			return
		}

		showToastBestEffort(ctx, {
			title: "ULTRAWORK LOOP",
			message: "DONE detected. Oracle verification is now required.",
			variant: "info",
			duration: 5000,
		})
		return
	}

	loopState.clear()

	const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Ralph Loop Complete!"
	const message = state.ultrawork
		? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)`
		: `Task completed after ${state.iteration} iteration(s)`
	showToastBestEffort(ctx, { title, message, variant: "success", duration: 5000 })
}
