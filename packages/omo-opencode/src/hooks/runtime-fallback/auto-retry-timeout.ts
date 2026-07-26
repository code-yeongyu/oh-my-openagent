import type { AutoRetryDispatchOutcome, HookDeps, RuntimeFallbackTimeout } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getFallbackModelsForSession } from "./fallback-models"
import { prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"
import { subagentSessions } from "../../features/claude-code-session-state"
import {
  isFallbackDispatchLeaseOwner,
  releaseFallbackDispatchLease,
  supersedeFallbackDispatchLease,
  type FallbackDispatchLease,
} from "./fallback-dispatch-lease"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export function createFallbackTimeoutHelpers(
  deps: HookDeps,
  abortSessionRequest: (sessionID: string, source: string) => Promise<void>,
  autoRetryWithFallback: (
    sessionID: string,
    newModel: string,
    resolvedAgent: string | undefined,
    source: string,
    suppliedLease?: FallbackDispatchLease,
  ) => Promise<AutoRetryDispatchOutcome>,
) {
  const {
    config,
    options,
    sessionStates,
    sessionRetryInFlight,
    sessionFallbackTimeouts,
    pluginConfig,
  } = deps

  const clearSessionFallbackTimeout = (sessionID: string) => {
    const timer = sessionFallbackTimeouts.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      sessionFallbackTimeouts.delete(sessionID)
    }
  }

  const scheduleSessionFallbackTimeout = (sessionID: string, resolvedAgent?: string) => {
    clearSessionFallbackTimeout(sessionID)

    const timeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
    if (timeoutMs <= 0) return
    const wasSubagentSession = subagentSessions.has(sessionID)

    const timer = setTimeout(async () => {
      sessionFallbackTimeouts.delete(sessionID)

      if (wasSubagentSession && !subagentSessions.has(sessionID)) {
        log(`[${HOOK_NAME}] Session fallback timeout skipped for completed subagent`, { sessionID })
        return
      }

      const state = sessionStates.get(sessionID)
      if (!state) return

      // Timeout escalation must move to the next model even when a prior
      // fallback is still waiting on OpenCode. Replacing its lease invalidates
      // the older async branch before it can submit or roll back stale work.
      const lease = supersedeFallbackDispatchLease(deps, sessionID)

      try {
        if (sessionRetryInFlight.has(sessionID)) {
          log(`[${HOOK_NAME}] Overriding in-flight retry due to session timeout`, { sessionID })
        }

        await abortSessionRequest(sessionID, "session.timeout")
        if (!isFallbackDispatchLeaseOwner(deps, sessionID, lease)) return

        if (state.pendingFallbackModel) {
          state.pendingFallbackModel = undefined
        }
        state.pendingFallbackPromptMayHaveBeenAccepted = false
        const stateSnapshot = snapshotFallbackState(state)

        const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
        if (fallbackModels.length === 0) return

        log(`[${HOOK_NAME}] Session fallback timeout reached`, {
          sessionID,
          timeoutSeconds: config.timeout_seconds,
          currentModel: state.currentModel,
        })

        const result = prepareFallback(sessionID, state, fallbackModels, config)
        if (result.success && result.newModel) {
          const dispatchOutcome = await autoRetryWithFallback(
            sessionID,
            result.newModel,
            resolvedAgent,
            "session.timeout",
            lease,
          )
          if (!isFallbackDispatchLeaseOwner(deps, sessionID, lease)) return
          if (!dispatchOutcome.accepted) {
            restoreFallbackState(state, stateSnapshot)
            if (deps.sessionAwaitingFallbackResult.has(sessionID)) {
              scheduleSessionFallbackTimeout(sessionID, resolvedAgent)
            }
            log(`[${HOOK_NAME}] Session timeout fallback dispatch was not accepted`, {
              sessionID,
              status: dispatchOutcome.status,
              reason: dispatchOutcome.reason,
            })
          }
        }
      } finally {
        if (isFallbackDispatchLeaseOwner(deps, sessionID, lease)) {
          sessionRetryInFlight.delete(sessionID)
        }
        releaseFallbackDispatchLease(deps, sessionID, lease)
      }
    }, timeoutMs)

    sessionFallbackTimeouts.set(sessionID, timer)
  }

  return {
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
  }
}
