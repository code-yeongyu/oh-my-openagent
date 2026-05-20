import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, RETRYABLE_ERROR_PATTERNS } from "./constants"
import { log } from "../../shared/logger"
import { extractAutoRetrySignal, isRetryableError } from "./error-classifier"
import { createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { normalizeRetryStatusMessage, extractRetryAttempt } from "../../shared/retry-status-utils"
import { resolveFallbackBootstrapModel, normalizeRuntimeFallbackModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { resolveSessionEventID } from "../../shared/event-session-id"

function hasExplicitProviderRetrySchedule(message: string): boolean {
  return /retrying\s+in|quota\s+will\s+reset\s+after|cool(?:ing)?\s+down|\bcooldown\b/i.test(message)
}

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
    const model = normalizeRuntimeFallbackModel(props?.model as Parameters<typeof normalizeRuntimeFallbackModel>[0])
    const timeoutEnabled = deps.config.timeout_seconds > 0

    if (!sessionID || status?.type !== "retry") return

    const retryMessage = typeof status.message === "string" ? status.message : ""
    const retrySignal = extractAutoRetrySignal({ status: retryMessage, message: retryMessage })
    const hasRetrySchedule = hasExplicitProviderRetrySchedule(retryMessage)
    if (!retrySignal) {
      // Fallback: status.type is already "retry", so treat the message as a
      // retryable session-status error if either the lightweight retry patterns
      // or the full runtime error classifier says it should advance the chain.
      const messageLower = retryMessage.toLowerCase()
      const matchesRetryablePattern = RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(messageLower))
      const retryableStatusError = isRetryableError({ name: "SessionRetry", message: retryMessage }, deps.config.retry_on_errors)
      if (!matchesRetryablePattern && !retryableStatusError) {
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

    if (!hasRetrySchedule) {
      log(`[${HOOK_NAME}] session.status retry treated as immediate retryable error fallback`, {
        sessionID,
        attempt: status.attempt,
        retryMessage,
      })
    }

    const retryKey = `${extractRetryAttempt(status.attempt, retryMessage)}:${normalizeRetryStatusMessage(retryMessage)}`
    if (sessionStatusRetryKeys.get(sessionID) === retryKey) {
      return
    }
    sessionStatusRetryKeys.set(sessionID, retryKey)

    if (sessionRetryInFlight.has(sessionID)) {
      if (timeoutEnabled) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to provider auto-retry signal`, {
          sessionID,
          model,
        })
        await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")
        sessionRetryInFlight.delete(sessionID)
      } else {
        log(`[${HOOK_NAME}] session.status retry skipped - retry already in flight`, { sessionID })
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

    if (hasRetrySchedule) {
      log(`[${HOOK_NAME}] Detected provider auto-retry signal in session.status`, {
        sessionID,
        model: state.currentModel,
        retryAttempt: status.attempt,
      })

      await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")
    } else {
      log(`[${HOOK_NAME}] Treating provider retry status as direct fallback trigger`, {
        sessionID,
        model: state.currentModel,
        retryAttempt: status.attempt,
      })
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
