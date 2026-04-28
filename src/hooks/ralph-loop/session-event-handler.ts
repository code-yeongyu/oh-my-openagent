import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import type { RalphLoopState } from "./types"

type LoopStateController = {
	getState: () => RalphLoopState | null
	clear: () => boolean
}

export function handleDeletedLoopSession(
	props: Record<string, unknown> | undefined,
	loopState: LoopStateController,
): boolean {
	const sessionInfo = props?.info as { id?: string } | undefined
	if (!sessionInfo?.id) return false

	const state = loopState.getState()
	if (state?.session_id === sessionInfo.id) {
		loopState.clear()
		log(`[${HOOK_NAME}] Session deleted, loop cleared`, { sessionID: sessionInfo.id })
	}
	return true
}

export function handleErroredLoopSession(
	props: Record<string, unknown> | undefined,
	loopState: LoopStateController,
): boolean {
	const sessionID = props?.sessionID as string | undefined
	const error = props?.error as { name?: string } | undefined

	if (error?.name === "MessageAbortedError") {
		if (sessionID) {
			const state = loopState.getState()
			if (state?.session_id === sessionID) {
				loopState.clear()
				log(`[${HOOK_NAME}] User aborted, loop cleared`, { sessionID })
			}
		}
		return true
	}

	if (sessionID) {
		log(`[${HOOK_NAME}] Session error ignored, loop remains active`, { sessionID })
	}
	return true
}
