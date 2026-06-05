import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"

export function createAbortSessionRequest(deps: HookDeps) {
  const { ctx } = deps

  return async (sessionID: string, source: string): Promise<void> => {
    if (
      source === "session.status.retry-signal" ||
      source === "message.updated.retry-signal" ||
      source === "session.timeout"
    ) {
      deps.internallyAbortedSessions.add(sessionID)
      deps.sessionLastAccess.set(sessionID, Date.now())
    }
    try {
      await ctx.client.session.abort({ path: { id: sessionID } })
      releasePromptAsyncReservation(sessionID, `runtime-fallback-abort:${source}`, {
        reservedBy: `runtime-fallback:${source}`,
        reservedByPrefix: "runtime-fallback:",
      })
      log(`[${HOOK_NAME}] Aborted in-flight session request (${source})`, { sessionID })
    } catch (error) {
      if (!(error instanceof Error)) {
        log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
          sessionID,
          error: String(error),
        })
        return
      }
      log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
        sessionID,
        error: String(error),
      })
    }
  }
}
