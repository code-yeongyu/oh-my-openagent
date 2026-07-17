import type { AutoRetryDispatchOutcome, HookDeps, RuntimeFallbackTimeout } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getFallbackModelsForSession } from "./fallback-models"
import { prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"
import { subagentSessions } from "../../features/claude-code-session-state"
import { isRuntimeFallbackActive } from "./lifecycle"
import { clearSessionRetryOwnership } from "./session-retry-ownership"
import { getSessionGeneration, isSessionGenerationCurrent } from "./session-generation"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export function createFallbackTimeoutHelpers(
  deps: HookDeps,
  abortSessionRequest: (sessionID: string, source: string) => Promise<boolean>,
  autoRetryWithFallback: (
    sessionID: string,
    newModel: string,
    resolvedAgent: string | undefined,
    source: string,
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
    if (!isRuntimeFallbackActive(deps)) return
    clearSessionFallbackTimeout(sessionID)

    const timeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
    if (timeoutMs <= 0) return
    const wasSubagentSession = subagentSessions.has(sessionID)
    const sessionGeneration = getSessionGeneration(deps, sessionID)
    const isCurrent = () => isRuntimeFallbackActive(deps)
      && isSessionGenerationCurrent(deps, sessionID, sessionGeneration)

    const timer = setTimeout(async () => {
      if (sessionFallbackTimeouts.get(sessionID) !== timer) return
      sessionFallbackTimeouts.delete(sessionID)
      if (!isCurrent()) return

      if (wasSubagentSession && !subagentSessions.has(sessionID)) {
        log(`[${HOOK_NAME}] Session fallback timeout skipped for completed subagent`, { sessionID })
        return
      }

      const state = sessionStates.get(sessionID)
      if (!state) return

      if (sessionRetryInFlight.has(sessionID)) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to session timeout`, { sessionID })
      }

      const abortSucceeded = await abortSessionRequest(sessionID, "session.timeout")
      if (!isCurrent() || sessionStates.get(sessionID) !== state) return
      if (!abortSucceeded) {
        log(`[${HOOK_NAME}] Session fallback timeout abort failed; preserving retry ownership`, { sessionID })
        return
      }
      clearSessionRetryOwnership(deps, sessionID)

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
        const dispatchOutcome = await autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.timeout")
        if (!isCurrent() || sessionStates.get(sessionID) !== state) return
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
    }, timeoutMs)

    sessionFallbackTimeouts.set(sessionID, timer)
  }

  return {
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
  }
}
