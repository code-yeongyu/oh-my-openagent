import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"

export function createAbortSessionRequest(deps: HookDeps) {
  const { ctx } = deps

  return async (sessionID: string, source: string): Promise<boolean> => {
    const isInternalAbort =
      source === "session.status.retry-signal" ||
      source === "message.updated.retry-signal" ||
      source === "message.updated.quota-fallback" ||
      source === "session.timeout" ||
      source === "first-prompt-watchdog"

    if (isInternalAbort) {
      deps.internallyAbortedSessions.add(sessionID)
      deps.sessionLastAccess.set(sessionID, Date.now())
    }
    try {
      await ctx.client.session.abort({ path: { id: sessionID } })
      releasePromptAsyncReservation(sessionID, `runtime-fallback-abort:${source}`, {
        reservedBy: `runtime-fallback:${source}`,
        reservedByPrefix: "runtime-fallback:",
        supersedeTransientRetryOwners: true,
      })
      log(`[${HOOK_NAME}] Aborted in-flight session request (${source})`, { sessionID })
      return true
    } catch (error) {
      if (isInternalAbort) {
        deps.internallyAbortedSessions.delete(sessionID)
      }
      if (!(error instanceof Error)) {
        log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
          sessionID,
          error: String(error),
        })
        return false
      }
      log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
        sessionID,
        error: String(error),
      })
      return false
    }
  }
}
