import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, RETRYABLE_ERROR_PATTERNS } from "./constants"
import { log } from "../../shared/logger"
import { extractAutoRetrySignal } from "./error-classifier"
import { areRuntimeModelsEquivalent, createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { normalizeRetryStatusMessage, extractRetryAttempt } from "../../shared/retry-status-utils"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { normalizeModelToCanonicalString } from "./normalize-model"
import {
  isFallbackDispatchLeaseOwner,
  releaseFallbackDispatchLease,
  supersedeFallbackDispatchLease,
  type FallbackDispatchLease,
} from "./fallback-dispatch-lease"

export function createSessionStatusHandler(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  sessionStatusRetryKeys: Map<string, string>,
) {
  const {
    pluginConfig,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
  } = deps

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

    const pendingFallbackModel = sessionStates.get(sessionID)?.pendingFallbackModel
    if (
      deps.sessionAwaitingFallbackResult.has(sessionID)
      && pendingFallbackModel
      && model
      && !areRuntimeModelsEquivalent(model, pendingFallbackModel)
    ) {
      log(`[${HOOK_NAME}] session.status retry skipped - awaiting a different fallback model`, {
        sessionID,
        pendingFallbackModel,
        model,
      })
      return
    }

    const retryKey = `${model ?? "unknown"}:${extractRetryAttempt(status.attempt, retryMessage)}:${normalizeRetryStatusMessage(retryMessage)}`
    if (sessionStatusRetryKeys.get(sessionID) === retryKey) {
      return
    }
    sessionStatusRetryKeys.set(sessionID, retryKey)

    const wasAwaitingFallbackResult = deps.sessionAwaitingFallbackResult.has(sessionID)
    const pendingFallbackPromptMayHaveBeenAccepted = sessionStates.get(sessionID)?.pendingFallbackPromptMayHaveBeenAccepted === true
    let takeoverLease: FallbackDispatchLease | undefined
    if (
      (sessionRetryInFlight.has(sessionID) || wasAwaitingFallbackResult)
      && !pendingFallbackPromptMayHaveBeenAccepted
    ) {
      if (timeoutEnabled) {
        log(`[${HOOK_NAME}] Overriding active retry due to provider auto-retry signal`, {
          sessionID,
          model,
        })
        takeoverLease = supersedeFallbackDispatchLease(deps, sessionID)
      } else {
        log(`[${HOOK_NAME}] session.status retry skipped - retry already in flight`, { sessionID })
        return
      }
    }

    try {
      if (takeoverLease) {
        await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")
        if (!isFallbackDispatchLeaseOwner(deps, sessionID, takeoverLease)) return
      }

      const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
      if (takeoverLease && !isFallbackDispatchLeaseOwner(deps, sessionID, takeoverLease)) return
      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
      if (fallbackModels.length === 0) {
        if (!sessionStates.has(sessionID)) {
          sessionStatusRetryKeys.delete(sessionID)
        }
        return
      }

      let state = sessionStates.get(sessionID)
      if (!state) {
        const initialModel = resolveFallbackBootstrapModel({
          sessionID,
          source: "session.status",
          eventModel: model,
          resolvedAgent,
          pluginConfig,
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
          state.pendingFallbackModel = undefined
          state.pendingFallbackPromptMayHaveBeenAccepted = false
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

      if (!takeoverLease) {
        await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")
      }
      if (takeoverLease && !isFallbackDispatchLeaseOwner(deps, sessionID, takeoverLease)) return

      await dispatchFallbackRetry(deps, helpers, {
        sessionID,
        state,
        fallbackModels,
        resolvedAgent,
        source: "session.status",
        lease: takeoverLease,
      })
    } finally {
      if (takeoverLease) {
        if (isFallbackDispatchLeaseOwner(deps, sessionID, takeoverLease)) {
          sessionRetryInFlight.delete(sessionID)
        }
        releaseFallbackDispatchLease(deps, sessionID, takeoverLease)
      }
    }
  }
}
