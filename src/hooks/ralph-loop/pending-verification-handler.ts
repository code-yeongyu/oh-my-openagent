import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import type { RalphLoopState } from "./types"
import { handleFailedVerification } from "./verification-failure-handler"

type LoopStateController = {
	restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null
}

export async function handlePendingVerification(
	ctx: PluginInput,
	input: {
		sessionID: string
		state: RalphLoopState
		verificationSessionID?: string
		matchesParentSession: boolean
		matchesVerificationSession: boolean
		loopState: LoopStateController
		directory: string
		apiTimeoutMs: number
	},
): Promise<void> {
	const {
		sessionID,
		state,
		verificationSessionID,
		matchesParentSession,
		matchesVerificationSession,
		loopState,
		directory,
		apiTimeoutMs,
	} = input

	if (matchesParentSession || (verificationSessionID && matchesVerificationSession)) {
		const restarted = await handleFailedVerification(ctx, {
			state,
			loopState,
			directory,
			apiTimeoutMs,
		})
		if (restarted) {
			return
		}
	}

	log(`[${HOOK_NAME}] Waiting for oracle verification`, {
		sessionID,
		verificationSessionID,
		iteration: state.iteration,
	})
}
