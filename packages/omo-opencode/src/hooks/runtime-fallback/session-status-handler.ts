import type { FallbackState, HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, RETRYABLE_ERROR_PATTERNS } from "./constants"
import { log } from "../../shared/logger"
import { extractAutoRetrySignal } from "./error-classifier"
import { canPrepareFallback, createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { normalizeRetryStatusMessage, extractRetryAttempt } from "../../shared/retry-status-utils"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { normalizeModelToCanonicalString } from "./normalize-model"
import { isCompactionInFlight } from "../../shared/compaction-in-flight"

export function createSessionStatusHandler(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  sessionStatusRetryKeys: Map<string, Set<string>>,
) {
  const {
    pluginConfig,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
  } = deps
  const exhaustionToastStates = deps.fallbackExhaustionToastStates ?? new Map<string, FallbackState>()

  const showExhaustedToast = async (sessionID: string, state?: FallbackState) => {
    if (state ? exhaustionToastStates.get(sessionID) === state : exhaustionToastStates.has(sessionID)) return
    exhaustionToastStates.set(sessionID, state ?? createFallbackState("unknown"))
    try {
      await deps.ctx.client.tui.showToast({ body: {
        title: "Runtime fallback",
        message: "Fallback attempts exhausted; native retry continues",
        variant: "warning",
        duration: 3000,
      } })
    } catch (error) {
      log(`[${HOOK_NAME}] fallback exhaustion toast failed`, { sessionID, error: String(error) })
    }
  }

  return async (props: Record<string, unknown> | undefined) => {
    const sessionID = resolveSessionEventID(props)
    const status = props?.status as { type?: string; message?: string; attempt?: number } | undefined
    const agent = props?.agent as string | undefined
    const model = normalizeModelToCanonicalString(props?.model)
    const timeoutEnabled = deps.config.timeout_seconds > 0

    if (!sessionID || status?.type !== "retry") return

    const retryMessage = typeof status.message === "string" ? status.message : ""
    const retrySignal = extractAutoRetrySignal({ status: retryMessage, message: retryMessage })
    if (!retrySignal) {
      // Fallback: status.type is already "retry", so check the message against
      // retryable error patterns directly. This handles providers like Gemini whose
      // retry status message may not contain "retrying in" text alongside the error.
      const messageLower = retryMessage.toLowerCase()
      const matchesRetryablePattern = RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(messageLower))
      if (!matchesRetryablePattern) {
        // Diagnostic: capture the actual retry message content so we can extend
        // RETRYABLE_ERROR_PATTERNS if a provider emits a phrasing we don't yet match.
        if (retryMessage) {
          log(`[${HOOK_NAME}] session.status retry with non-matching message`, {
            sessionID,
            attempt: status.attempt,
            retryMessage,
          })
        }
        return
      }
    }

    if (isCompactionInFlight(sessionID)) {
      log(`[${HOOK_NAME}] retry signal belongs to compaction lane; primary chain untouched (compaction-lane-retry-ignored)`, { sessionID })
      return
    }

    const retryModel = model ?? "unknown"
    const retryKey = `${retryModel}:${extractRetryAttempt(status.attempt, retryMessage)}:${normalizeRetryStatusMessage(retryMessage)}`
    const seenRetryKeys = sessionStatusRetryKeys.get(sessionID) ?? new Set<string>()
    if (seenRetryKeys.has(retryKey)) {
      return
    }
    seenRetryKeys.add(retryKey)
    sessionStatusRetryKeys.set(sessionID, seenRetryKeys)

    let shouldAbortInFlightRetry = false

    if (sessionRetryInFlight.has(sessionID)) {
      if (timeoutEnabled) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to provider auto-retry signal`, {
          sessionID,
          model,
        })
        const state = sessionStates.get(sessionID)
        const resolvedAgentForAbort = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
        const availableModels = getFallbackModelsForSession(sessionID, resolvedAgentForAbort, pluginConfig)
        if (!canPrepareFallback(state, availableModels, deps.config, model)) {
          log(`[${HOOK_NAME}] fallback exhausted; leaving native retry running (fallback-exhausted-no-abort)`, { sessionID })
          await showExhaustedToast(sessionID, state)
          return
        }
        shouldAbortInFlightRetry = true
      } else {
        log(`[${HOOK_NAME}] session.status retry skipped - retry already in flight`, { sessionID })
        seenRetryKeys?.delete(retryKey)
        if (seenRetryKeys?.size === 0) {
          sessionStatusRetryKeys.delete(sessionID)
        }
        return
      }
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
    if (fallbackModels.length === 0) {
      if (!sessionStates.has(sessionID)) {
        sessionStatusRetryKeys.delete(sessionID)
      }
      return
    }

    const stateBeforeMutation = sessionStates.get(sessionID)
    if (!canPrepareFallback(stateBeforeMutation, fallbackModels, deps.config, model)) {
      log(`[${HOOK_NAME}] fallback exhausted; leaving native retry running (fallback-exhausted-no-abort)`, { sessionID })
      await showExhaustedToast(sessionID, stateBeforeMutation)
      return
    }

    let state = sessionStates.get(sessionID)
    if (!state) {
      const initialModel = await resolveFallbackBootstrapModel({
        sessionID,
        source: "session.status",
        eventModel: model,
        resolvedAgent,
        pluginConfig,
        ctx: deps.ctx,
      })
      if (!initialModel) {
        sessionStatusRetryKeys.delete(sessionID)
        log(`[${HOOK_NAME}] session.status retry missing model info, cannot fallback`, { sessionID })
        return
      }

      state = createFallbackState(initialModel)
      sessionStates.set(sessionID, state)
    }

    sessionLastAccess.set(sessionID, Date.now())

    if (state.pendingFallbackModel) {
      if (state.pendingFallbackPromptMayHaveBeenAccepted) {
        log(`[${HOOK_NAME}] session.status retry skipped (pending fallback prompt may already be accepted)`, {
          sessionID,
          pendingFallbackModel: state.pendingFallbackModel,
        })
        return
      }
      if (timeoutEnabled) {
        log(`[${HOOK_NAME}] Clearing pending fallback due to provider auto-retry signal`, {
          sessionID,
          pendingFallbackModel: state.pendingFallbackModel,
        })
      } else {
        log(`[${HOOK_NAME}] session.status retry skipped (pending fallback in progress)`, {
          sessionID,
          pendingFallbackModel: state.pendingFallbackModel,
        })
        return
      }
    }

    log(`[${HOOK_NAME}] Detected provider auto-retry signal in session.status`, {
      sessionID,
      model: state.currentModel,
      retryAttempt: status.attempt,
    })

    if (!canPrepareFallback(state, fallbackModels, deps.config)) {
      log(`[${HOOK_NAME}] fallback exhausted; leaving native retry running (fallback-exhausted-no-abort)`, { sessionID })
      await showExhaustedToast(sessionID, state)
      return
    }
    await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")
    if (shouldAbortInFlightRetry) {
      sessionRetryInFlight.delete(sessionID)
    }

    if (state.pendingFallbackModel) {
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
    }

    await dispatchFallbackRetry(deps, helpers, {
      sessionID,
      state,
      fallbackModels,
      resolvedAgent,
      source: "session.status",
    })
  }
}
