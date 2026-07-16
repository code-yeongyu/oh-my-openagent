import { clearBoulderState } from "../features/boulder-state"
import { log } from "../shared"

type StopContinuationHooks = {
  readonly stopContinuationGuard?: {
    readonly stop?: (sessionID: string) => void
  } | null
  readonly todoContinuationEnforcer?: {
    readonly cancelAllCountdowns: () => void
  } | null
  readonly ralphLoop?: {
    readonly cancelLoop: (sessionID: string) => boolean | void
  } | null
}

export function stopContinuation(args: {
  readonly directory: string
  readonly hooks: StopContinuationHooks
  readonly sessionID: string
}): void {
  const { directory, hooks, sessionID } = args
  hooks.stopContinuationGuard?.stop?.(sessionID)
  hooks.todoContinuationEnforcer?.cancelAllCountdowns()
  hooks.ralphLoop?.cancelLoop(sessionID)
  clearBoulderState(directory)
  log("[stop-continuation] All continuation mechanisms stopped", { sessionID })
}
