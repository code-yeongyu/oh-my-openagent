import { log } from "../../shared/logger"
import { getPromptReservation } from "../../shared/prompt-async-gate/reservations"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"
import { HOOK_NAME } from "./constants"
import { acquireInternalAbortOwnership, releaseInternalAbortOwnership } from "./internal-abort-ownership"
import { isRuntimeFallbackActive } from "./lifecycle"
import type { HookDeps } from "./types"

export function createAbortSessionRequest(deps: HookDeps) {
  const { ctx } = deps

  return async (sessionID: string, source: string): Promise<boolean> => {
    const isInternalAbort =
      source === "session.status.retry-signal" ||
      source === "message.updated.retry-signal" ||
      source === "message.updated.quota-fallback" ||
      source === "session.timeout" ||
      source === "first-prompt-watchdog"
    let request: Promise<boolean> | undefined
    const isCurrentAbortRequest = () => deps.internalAbortRequests?.get(sessionID) === request

    const runAbort = async (): Promise<boolean> => {
      if (!isRuntimeFallbackActive(deps)) return false
      if (isInternalAbort) {
        acquireInternalAbortOwnership(deps, sessionID)
        deps.sessionLastAccess.set(sessionID, Date.now())
      }
      const reservationToken = getPromptReservation(sessionID)?.token
      try {
        const result = await ctx.client.session.abort({
          path: { id: sessionID },
          throwOnError: true,
        })
        if (isInternalAbort && !isCurrentAbortRequest()) {
          releaseInternalAbortOwnership(deps, sessionID)
          return false
        }
        if (!isRuntimeFallbackActive(deps)) {
          if (isInternalAbort) releaseInternalAbortOwnership(deps, sessionID)
          return false
        }
        if (
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          result.error !== undefined
        ) {
          if (isInternalAbort) {
            releaseInternalAbortOwnership(deps, sessionID)
          }
          log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
            sessionID,
            error: String(result.error),
          })
          return false
        }
        if (reservationToken !== undefined && getPromptReservation(sessionID)?.token === reservationToken) {
          releasePromptAsyncReservation(sessionID, `runtime-fallback-abort:${source}`, {
            reservedBy: `runtime-fallback:${source}`,
            reservedByPrefix: "runtime-fallback:",
            supersedeTransientRetryOwners: true,
          })
        }
        log(`[${HOOK_NAME}] Aborted in-flight session request (${source})`, { sessionID })
        return true
      } catch (error) {
        if (isInternalAbort && !isCurrentAbortRequest()) {
          releaseInternalAbortOwnership(deps, sessionID)
          return false
        }
        if (isInternalAbort) {
          releaseInternalAbortOwnership(deps, sessionID)
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
          error: error.message,
        })
        return false
      }
    }

    if (!isInternalAbort) return runAbort()
    deps.internalAbortRequests ??= new Map()
    const existingRequest = deps.internalAbortRequests.get(sessionID)
    if (existingRequest) {
      await existingRequest
      return false
    }

    request = runAbort()
    deps.internalAbortRequests.set(sessionID, request)
    try {
      return await request
    } finally {
      if (deps.internalAbortRequests.get(sessionID) === request) {
        deps.internalAbortRequests.delete(sessionID)
      }
    }
  }
}
