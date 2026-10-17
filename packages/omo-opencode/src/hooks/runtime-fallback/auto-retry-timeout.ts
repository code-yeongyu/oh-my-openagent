import type { AutoRetryDispatchOutcome, FallbackState, HookDeps, RuntimeFallbackTimeout } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getFallbackModelsForSession } from "./fallback-models"
import { prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"
import { subagentSessions } from "../../features/claude-code-session-state"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

// Deliberately absent from the internal-abort source list in auto-retry-abort.ts:
// this abort must reach the caller as a real cancellation instead of being
// consumed as a silent fallback handoff.
const TERMINAL_ABORT_SOURCE = "session.timeout.fallback-exhausted"

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

  const clearSessionFallbackTimeout = (sessionID: string) => {
    const timer = sessionFallbackTimeouts.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      sessionFallbackTimeouts.delete(sessionID)
    }
  }

  // Ends the fallback lifecycle with a failure the caller can observe. Without
  // this the session keeps waiting on a fallback that will never arrive (#6637).
  const failSessionFallbackTerminally = async (
    sessionID: string,
    expectedState: FallbackState,
    reason: string,
    details: Record<string, unknown> = {},
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

    if (config.notify_on_fallback) {
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

  const scheduleSessionFallbackTimeout = (sessionID: string, resolvedAgent?: string) => {
    clearSessionFallbackTimeout(sessionID)

    const timeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
    if (timeoutMs <= 0) return
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

      if (sessionRetryInFlight.has(sessionID)) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to session timeout`, { sessionID })
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

      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
      if (fallbackModels.length === 0) {
        await failSessionFallbackTerminally(sessionID, state, "no fallback models configured")
        return
      }

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

      const dispatchOutcome = await autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.timeout")
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
        scheduleSessionFallbackTimeout(sessionID, resolvedAgent)
      }
    }, timeoutMs)

    sessionFallbackTimeouts.set(sessionID, timer)
  }

  return {
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
  }
}
