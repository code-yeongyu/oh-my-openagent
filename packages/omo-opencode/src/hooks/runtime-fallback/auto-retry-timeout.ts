import type { AutoRetryDispatchOutcome, FallbackState, HookDeps, RuntimeFallbackTimeout } from "./types"
import { COMPACTION_WATCHDOG_BUDGET_MS, HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getFallbackModelsForSession } from "./fallback-models"
import { canPrepareFallback, prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"
import { subagentSessions } from "../../features/claude-code-session-state"
import { getCompaction, recordCompactionEnd } from "../../shared/compaction-in-flight"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

// Deliberately absent from the internal-abort source list in auto-retry-abort.ts:
// this abort must reach the caller as a real cancellation instead of being
// consumed as a silent fallback handoff.
const TERMINAL_ABORT_SOURCE = "session.timeout.fallback-exhausted"

// Below the attempt cap, canPrepareFallback fails only because every remaining model is cooling
// down or already used, which is what prepareFallback reports as "no available fallback models".
function wedgeReturnReason(fallbackModels: number, attemptCount: number, maxAttempts: number): string {
  if (fallbackModels === 0) return "no fallback models configured"
  return attemptCount >= maxAttempts ? "max fallback attempts reached" : "no available fallback models"
}

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
  const { config, options, sessionStates, sessionRetryInFlight, sessionFallbackTimeouts, pluginConfig } = deps
  const sessionResolvedAgents = new Map<string, string>()

  const showWatchdogToast = async (sessionID: string, message: string) => {
    try {
      await deps.ctx.client.tui.showToast({
        body: {
          title: "Runtime fallback",
          message,
          variant: "warning",
          duration: 3000,
        },
      })
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

  // Ends the fallback lifecycle with a failure the caller can observe. Without
  // this the session keeps waiting on a fallback that will never arrive (#6637).
  const failSessionFallbackTerminally = async (
    sessionID: string,
    expectedState: FallbackState,
    reason: string,
    details: Record<string, unknown> = {},
    watchdogMessage = "Runtime fallback dispatch was not accepted",
  ) => {
    clearSessionFallbackTimeout(sessionID)
    sessionRetryInFlight.delete(sessionID)
    const wasAwaitingFallbackResult = deps.sessionAwaitingFallbackResult.delete(sessionID)

    log(`[${HOOK_NAME}] Session fallback exhausted`, { sessionID, reason, ...details })

    // The timeout path already marked this session as internally aborted. Leaving
    // that marker behind would make a later real abort look like our own fallback
    // handoff and preserve fallback state that no longer has an owner.
    deps.internallyAbortedSessions.delete(sessionID)
    if (!wasAwaitingFallbackResult) return

    // The user learns once that control came back: the detailed error toast when
    // fallback notifications are on, otherwise the watchdog warning.
    if (!config.notify_on_fallback) {
      void showWatchdogToast(sessionID, watchdogMessage)
    } else {
      // Best effort, not awaited: a showToast() call that never settles must
      // not block the terminal abort below, or the caller is left hanging on
      // the very rejected-fallback path this function exists to bound.
      void deps.ctx.client.tui
        .showToast({
          body: {
            title: "Model Fallback Failed",
            message: `No fallback model could be reached (${reason})`,
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {})
    }

    // The caller already awaited a dispatch or a prepare step before reaching
    // this function, which is enough time for a newer fallback generation to
    // take over the session. Aborting that generation would cancel a retry
    // this call never owned, so ownership is revalidated before the abort.
    if (sessionStates.get(sessionID) !== expectedState) {
      log(`[${HOOK_NAME}] Session fallback terminal abort skipped for superseded generation`, {
        sessionID,
      })
      return
    }

    await abortSessionRequest(sessionID, TERMINAL_ABORT_SOURCE)
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
          log(`[${HOOK_NAME}] compaction in flight; deferring session timeout (compaction-aware-timeout)`, {
            sessionID,
          })
          scheduleSessionFallbackTimeout(
            sessionID,
            effectiveResolvedAgent,
            Math.min(timeoutMs, COMPACTION_WATCHDOG_BUDGET_MS - elapsed),
          )
          return
        }
        log(
          `[${HOOK_NAME}] compaction watchdog budget exhausted; returning control without fallback (compaction-aware-timeout)`,
          {
            sessionID,
            elapsed,
            budgetMs: COMPACTION_WATCHDOG_BUDGET_MS,
          },
        )
        // Control goes back to the user and nothing retries, so ownership is released before any await:
        // the abort's own session.error must not find a retry in flight, and a toast that never settles
        // must not leave the session marked as owning recovery. The abort uses the terminal source so
        // it reaches the caller as a real cancellation, not a fallback handoff.
        deps.sessionAwaitingFallbackResult.delete(sessionID)
        sessionRetryInFlight.delete(sessionID)
        sessionResolvedAgents.delete(sessionID)
        deps.internallyAbortedSessions.delete(sessionID)
        await abortSessionRequest(sessionID, TERMINAL_ABORT_SOURCE)
        recordCompactionEnd(sessionID)
        // Events caused by the abort can re-arm the watchdog while it is pending.
        clearSessionFallbackTimeout(sessionID)
        void showWatchdogToast(sessionID, "Compaction exceeded its watchdog budget")
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
        log(
          `[${HOOK_NAME}] fallback exhausted; aborting stuck session without replacement (fallback-exhausted-wedge-return)`,
          {
            sessionID,
            fallbackModels: fallbackModels.length,
          },
        )
        // An awaiting caller gets exactly one observable terminal abort (#6637);
        // without one, the stuck stream is returned with a plain timeout abort.
        const awaitingCaller = deps.sessionAwaitingFallbackResult.has(sessionID)
        if (!awaitingCaller) {
          await abortSessionRequest(sessionID, "session.timeout")
        }
        await failSessionFallbackTerminally(
          sessionID,
          state,
          wedgeReturnReason(fallbackModels.length, state.attemptCount, config.max_fallback_attempts),
          { attemptCount: state.attemptCount },
          "Runtime fallback could not prepare a replacement",
        )
        // Same window as the budget branch: nothing may stay armed once control is returned.
        clearSessionFallbackTimeout(sessionID)
        // With nobody awaiting, the terminal path above stays silent; the user still learns once that
        // control came back, as on a refused dispatch.
        if (!awaitingCaller) await showWatchdogToast(sessionID, "Runtime fallback could not prepare a replacement")
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
      if (!result.success || !result.newModel) {
        await failSessionFallbackTerminally(
          sessionID,
          state,
          result.maxAttemptsReached ? "max fallback attempts reached" : "no available fallback models",
          { attemptCount: state.attemptCount },
        )
        return
      }

      const preparedOwnership = {
        currentModel: state.currentModel,
        fallbackIndex: state.fallbackIndex,
        attemptCount: state.attemptCount,
      }

      const dispatchOutcome = await autoRetryWithFallback(
        sessionID,
        result.newModel,
        effectiveResolvedAgent,
        "session.timeout",
      )
      if (dispatchOutcome.accepted) return

      // Identity alone is not ownership: a superseding retry can advance the same
      // FallbackState object without replacing it. Only the dispatch that still
      // owns exactly what prepareFallback produced may roll that preparation back.
      const stillOwnsPreparedState =
        sessionStates.get(sessionID) === state &&
        state.currentModel === preparedOwnership.currentModel &&
        state.fallbackIndex === preparedOwnership.fallbackIndex &&
        state.attemptCount === preparedOwnership.attemptCount
      if (!stillOwnsPreparedState) {
        log(`[${HOOK_NAME}] Session timeout fallback rejection skipped for superseded dispatch`, {
          sessionID,
        })
        return
      }

      // A rejected dispatch still burned an attempt. Restoring the snapshot
      // verbatim would rewind attemptCount as well, leaving the guard in
      // prepareFallback unreachable and the timeout loop unbounded (#6637).
      const attemptsUsed = state.attemptCount
      restoreFallbackState(state, stateSnapshot)
      state.attemptCount = attemptsUsed

      log(`[${HOOK_NAME}] Session timeout fallback dispatch was not accepted`, {
        sessionID,
        status: dispatchOutcome.status,
        reason: dispatchOutcome.reason,
        attemptCount: attemptsUsed,
      })

      if (attemptsUsed >= config.max_fallback_attempts) {
        await failSessionFallbackTerminally(sessionID, state, "max fallback attempts reached", {
          attemptCount: attemptsUsed,
        })
        return
      }

      if (deps.sessionAwaitingFallbackResult.has(sessionID)) {
        scheduleSessionFallbackTimeout(sessionID, effectiveResolvedAgent)
        return
      }

      // Nobody awaits a retry, so this refusal ends the lifecycle: tell the user once.
      await showWatchdogToast(sessionID, "Runtime fallback dispatch was not accepted")
    }, delayMs)

    sessionFallbackTimeouts.set(sessionID, timer)
  }

  return {
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
  }
}
