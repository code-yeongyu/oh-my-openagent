import type { AutoRetryDispatchOutcome, HookDeps, RuntimeFallbackTimeout } from "./types"
import { COMPACTION_WATCHDOG_BUDGET_MS, HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getFallbackModelsForSession } from "./fallback-models"
import { canPrepareFallback, prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"
import { subagentSessions } from "../../features/claude-code-session-state"
import { getCompaction, recordCompactionEnd } from "../../shared/compaction-in-flight"

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
  const sessionResolvedAgents = new Map<string, string>()

  const showWatchdogToast = async (sessionID: string, message: string) => {
    try {
      await deps.ctx.client.tui.showToast({ body: {
        title: "Runtime fallback",
        message,
        variant: "warning",
        duration: 3000,
      } })
    } catch (error) {
      log(`[${HOOK_NAME}] Session fallback watchdog toast failed`, { sessionID, error: String(error) })
    }
  }

  const clearSessionFallbackTimeout = (sessionID: string) => {
    const timer = sessionFallbackTimeouts.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      sessionFallbackTimeouts.delete(sessionID)
    }
    sessionResolvedAgents.delete(sessionID)
  }

  const scheduleSessionFallbackTimeout = (sessionID: string, resolvedAgent?: string, delayOverride?: number) => {
    const effectiveResolvedAgent = resolvedAgent ?? sessionResolvedAgents.get(sessionID)
    clearSessionFallbackTimeout(sessionID)
    if (effectiveResolvedAgent) {
      sessionResolvedAgents.set(sessionID, effectiveResolvedAgent)
    }

    const timeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
    if (timeoutMs <= 0) return
    const delayMs = delayOverride ?? timeoutMs
    const wasSubagentSession = subagentSessions.has(sessionID)
    const fallbackState = sessionStates.get(sessionID)

    const timer = setTimeout(async () => {
      if (sessionFallbackTimeouts.get(sessionID) !== timer) {
        log(`[${HOOK_NAME}] Session fallback timeout skipped after timer replacement`, { sessionID })
        return
      }
      sessionFallbackTimeouts.delete(sessionID)

      if (wasSubagentSession && !subagentSessions.has(sessionID)) {
        log(`[${HOOK_NAME}] Session fallback timeout skipped for completed subagent`, { sessionID })
        return
      }

      if (!fallbackState || sessionStates.get(sessionID) !== fallbackState) {
        log(`[${HOOK_NAME}] Session fallback timeout skipped for stale state generation`, {
          sessionID,
        })
        return
      }
      const state = fallbackState

      const compaction = getCompaction(sessionID)
      if (compaction && !compaction.endedAt) {
        const elapsed = Date.now() - compaction.startedAt
        if (elapsed < COMPACTION_WATCHDOG_BUDGET_MS) {
          log(`[${HOOK_NAME}] compaction in flight; deferring session timeout (compaction-aware-timeout)`, { sessionID })
          scheduleSessionFallbackTimeout(
            sessionID,
            effectiveResolvedAgent,
            Math.min(timeoutMs, COMPACTION_WATCHDOG_BUDGET_MS - elapsed),
          )
          return
        }
        log(`[${HOOK_NAME}] compaction watchdog budget exhausted; returning control without fallback (compaction-aware-timeout)`, {
          sessionID,
          elapsed,
          budgetMs: COMPACTION_WATCHDOG_BUDGET_MS,
        })
        await abortSessionRequest(sessionID, "session.timeout")
        recordCompactionEnd(sessionID)
        await showWatchdogToast(sessionID, "Compaction exceeded its watchdog budget")
        deps.sessionAwaitingFallbackResult.delete(sessionID)
        sessionRetryInFlight.delete(sessionID)
        sessionResolvedAgents.delete(sessionID)
        // Events caused by the abort can re-arm the watchdog while the awaits above are pending.
        clearSessionFallbackTimeout(sessionID)
        return
      }

      if (compaction?.endedAt) {
        const elapsed = Date.now() - compaction.endedAt
        if (elapsed < timeoutMs) {
          scheduleSessionFallbackTimeout(sessionID, effectiveResolvedAgent, timeoutMs - elapsed)
          return
        }
      }

      if (sessionRetryInFlight.has(sessionID)) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to session timeout`, { sessionID })
      }

      const fallbackModels = getFallbackModelsForSession(sessionID, effectiveResolvedAgent, pluginConfig)
      if (!canPrepareFallback(state, fallbackModels, config)) {
        // A timeout outside compaction is a deliberate wedge return: the stream
        // is considered stuck, so abort to return control to the user even when
        // no replacement can be prepared. This branch never dispatches.
        log(`[${HOOK_NAME}] fallback exhausted; aborting stuck session without replacement (fallback-exhausted-wedge-return)`, {
          sessionID,
          fallbackModels: fallbackModels.length,
        })
        await abortSessionRequest(sessionID, "session.timeout")
        await showWatchdogToast(sessionID, "Runtime fallback could not prepare a replacement")
        deps.sessionAwaitingFallbackResult.delete(sessionID)
        sessionRetryInFlight.delete(sessionID)
        sessionResolvedAgents.delete(sessionID)
        // Same window as the budget branch: nothing may stay armed once control is returned.
        clearSessionFallbackTimeout(sessionID)
        return
      }

      await abortSessionRequest(sessionID, "session.timeout")
      if (sessionStates.get(sessionID) !== state) {
        log(`[${HOOK_NAME}] Session fallback timeout skipped for stale state generation`, {
          sessionID,
        })
        return
      }
      sessionRetryInFlight.delete(sessionID)

      if (state.pendingFallbackModel) {
        state.pendingFallbackModel = undefined
      }
      state.pendingFallbackPromptMayHaveBeenAccepted = false
      const stateSnapshot = snapshotFallbackState(state)

      log(`[${HOOK_NAME}] Session fallback timeout reached`, {
        sessionID,
        timeoutSeconds: config.timeout_seconds,
        currentModel: state.currentModel,
      })

      const result = prepareFallback(sessionID, state, fallbackModels, config)
      if (result.success && result.newModel) {
        const dispatchOutcome = await autoRetryWithFallback(sessionID, result.newModel, effectiveResolvedAgent, "session.timeout")
        if (!dispatchOutcome.accepted) {
          restoreFallbackState(state, stateSnapshot)
          state.pendingFallbackModel = undefined
          state.pendingFallbackPromptMayHaveBeenAccepted = false
          deps.sessionAwaitingFallbackResult.delete(sessionID)
          deps.sessionRetryInFlight.delete(sessionID)
          sessionResolvedAgents.delete(sessionID)
          clearSessionFallbackTimeout(sessionID)
          await showWatchdogToast(sessionID, "Runtime fallback dispatch was not accepted")
          log(`[${HOOK_NAME}] Session timeout fallback dispatch was not accepted`, {
            sessionID,
            status: dispatchOutcome.status,
            reason: dispatchOutcome.reason,
            clearedPendingFallbackState: true,
          })
        }
      }
    }, delayMs)

    sessionFallbackTimeouts.set(sessionID, timer)
  }

  return {
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
  }
}
