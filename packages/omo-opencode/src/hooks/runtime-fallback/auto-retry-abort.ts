import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"

export const FIRST_PROMPT_WATCHDOG_ABORT_SOURCE = "first-prompt-watchdog"
export const SUBAGENT_QUOTA_NO_FALLBACK_ABORT_SOURCE = "message.updated.subagent-quota-no-fallback"

// Every abort WE trigger to swap a fallback model must be classified internal here;
// an unclassified source surfaces as session.error cancellation and poisons the
// cancelledSessions mark (runaway abort/re-dispatch loop, incident ses_fa750d527ffe).
const INTERNALLY_ABORTED_SOURCES: ReadonlySet<string> = new Set([
  "session.status.retry-signal",
  "message.updated.retry-signal",
  "message.updated.quota-fallback",
  "session.timeout",
  FIRST_PROMPT_WATCHDOG_ABORT_SOURCE,
  SUBAGENT_QUOTA_NO_FALLBACK_ABORT_SOURCE,
])

export function createAbortSessionRequest(deps: HookDeps) {
  const { ctx } = deps

  return async (sessionID: string, source: string): Promise<void> => {
    if (INTERNALLY_ABORTED_SOURCES.has(source)) {
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
