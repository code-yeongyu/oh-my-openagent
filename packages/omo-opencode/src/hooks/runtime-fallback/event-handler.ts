import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { extractStatusCode, extractErrorName, classifyErrorType, isRetryableError } from "./error-classifier"
import { createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { isAbortError } from "../../shared/is-abort-error"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { createSessionStatusHandler } from "./session-status-handler"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { clearInternalAbortOwnership, consumeInternalAbortOwnership } from "./internal-abort-ownership"
import { isRuntimeFallbackActive } from "./lifecycle"
import { resolveCreatedSessionModel, resolveEventModel } from "./event-model"
import type { FallbackOwnershipTransfer } from "./first-prompt-watchdog-ownership"
import { bumpSessionGeneration, invalidateSessionGeneration } from "./session-generation"

export function createEventHandler(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  onStatusFallbackOwnershipTransferred?: (sessionID: string) => FallbackOwnershipTransfer | undefined,
) {
  const { config, pluginConfig, sessionStates, sessionLastAccess, sessionRetryInFlight, sessionAwaitingFallbackResult, sessionFallbackTimeouts, sessionStatusRetryKeys } = deps
  const cancelledSessions = new Set<string>()
  const sessionStatusHandler = createSessionStatusHandler(
    deps,
    helpers,
    onStatusFallbackOwnershipTransferred,
    (sessionID) => cancelledSessions.has(sessionID),
  )

  const resetRetryState = (sessionID: string) => {
    const state = sessionStates.get(sessionID)
    if (state) {
      sessionStates.set(sessionID, createFallbackState(state.originalModel))
    }

    sessionRetryInFlight.delete(sessionID)
    sessionAwaitingFallbackResult.delete(sessionID)
    clearInternalAbortOwnership(deps, sessionID)
    sessionStatusRetryKeys.delete(sessionID)
    helpers.clearSessionFallbackTimeout(sessionID)
  }

  const handleSessionCreated = (props: Record<string, unknown> | undefined) => {
    const sessionID = resolveSessionEventID(props)
    if (sessionID) {
      const sessionModel = resolveCreatedSessionModel(sessionID, props, pluginConfig)
      if (!sessionModel) return
      const { model, preferredModel, fallbackIndex } = sessionModel
      log(`[${HOOK_NAME}] Session created with model`, { sessionID, model })
      const state = createFallbackState(fallbackIndex >= 0 && preferredModel ? preferredModel : model)
      if (fallbackIndex >= 0) {
        state.currentModel = model
        state.fallbackIndex = fallbackIndex
      }
      sessionStates.set(sessionID, state)
      sessionLastAccess.set(sessionID, Date.now())
    }
  }

  const handleSessionDeleted = (props: Record<string, unknown> | undefined) => {
    const sessionID = resolveSessionEventID(props)

    if (sessionID) {
      invalidateSessionGeneration(deps, sessionID)
      log(`[${HOOK_NAME}] Cleaning up session state`, { sessionID })
      cancelledSessions.delete(sessionID)
      sessionStates.delete(sessionID)
      sessionLastAccess.delete(sessionID)
      sessionRetryInFlight.delete(sessionID)
      sessionAwaitingFallbackResult.delete(sessionID)
      clearInternalAbortOwnership(deps, sessionID)
      helpers.clearSessionFallbackTimeout(sessionID)
      sessionStatusRetryKeys.delete(sessionID)
      SessionCategoryRegistry.remove(sessionID)
    }
  }

  const handleSessionStop = async (props: Record<string, unknown> | undefined) => {
    const sessionID = resolveSessionEventID(props)
    if (!sessionID) return

    bumpSessionGeneration(deps, sessionID)
    cancelledSessions.add(sessionID)
    if (sessionRetryInFlight.has(sessionID) || sessionAwaitingFallbackResult.has(sessionID)) {
      await helpers.abortSessionRequest(sessionID, "session.stop")
    }

    resetRetryState(sessionID)

    log(`[${HOOK_NAME}] Cleared fallback retry state on session.stop`, { sessionID })
  }

  const handleMessageUpdated = (props: Record<string, unknown> | undefined) => {
    const info = props?.info as Record<string, unknown> | undefined
    const sessionID = resolveMessageEventSessionID(props)
    const role = info?.role as string | undefined
    if (!sessionID || role !== "user") return

    bumpSessionGeneration(deps, sessionID)
    cancelledSessions.delete(sessionID)
  }

  const handleSessionIdle = (props: Record<string, unknown> | undefined) => {
    const sessionID = resolveSessionEventID(props)
    if (!sessionID) return

    if (cancelledSessions.has(sessionID)) {
      resetRetryState(sessionID)
      cancelledSessions.delete(sessionID)
      log(`[${HOOK_NAME}] Cleared fallback retry state for cancelled session on idle`, { sessionID })
      return
    }

    if (sessionAwaitingFallbackResult.has(sessionID)) {
      log(`[${HOOK_NAME}] session.idle while awaiting fallback result; keeping timeout armed`, { sessionID })
      return
    }

    const hadTimeout = sessionFallbackTimeouts.has(sessionID)
    helpers.clearSessionFallbackTimeout(sessionID)
    sessionRetryInFlight.delete(sessionID)
    sessionStatusRetryKeys.delete(sessionID)

    const state = sessionStates.get(sessionID)
    if (state?.pendingFallbackModel) {
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
    }

    if (hadTimeout) {
      log(`[${HOOK_NAME}] Cleared fallback timeout after session completion`, { sessionID })
    }
  }

  const handleSessionError = async (props: Record<string, unknown> | undefined) => {
    const sessionID = resolveSessionEventID(props)
    const error = props?.error
    const agent = props?.agent as string | undefined

    if (!sessionID) {
      log(`[${HOOK_NAME}] session.error without sessionID, skipping`)
      return
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
    if (!isRuntimeFallbackActive(deps)) return

    if (isAbortError(error)) {
      // If we triggered this abort to swap in a fallback model, consume the
      // flag and preserve state — wiping attemptCount here is what causes
      // the infinite retry loop (issue #4006).
      if (consumeInternalAbortOwnership(deps, sessionID)) {
        log(`[${HOOK_NAME}] session.error matched internal abort; preserving retry state`, { sessionID, resolvedAgent })
        return
      }
      cancelledSessions.add(sessionID)
      resetRetryState(sessionID)
      log(`[${HOOK_NAME}] session.error matched cancellation; cleared retry state`, { sessionID, resolvedAgent })
      return
    }

    if (sessionRetryInFlight.has(sessionID)) {
      log(`[${HOOK_NAME}] session.error skipped - retry in flight`, {
        sessionID,
        retryInFlight: true,
      })
      return
    }

    if (sessionAwaitingFallbackResult.has(sessionID)) {
      const pendingFallbackModel = sessionStates.get(sessionID)?.pendingFallbackModel
      const eventModel = resolveEventModel(props)
      if (!pendingFallbackModel || eventModel !== pendingFallbackModel) {
        log(`[${HOOK_NAME}] session.error skipped - awaiting fallback result`, {
          sessionID,
          pendingFallbackModel,
          eventModel,
        })
        return
      }
    }

    sessionAwaitingFallbackResult.delete(sessionID)
    helpers.clearSessionFallbackTimeout(sessionID)

    log(`[${HOOK_NAME}] session.error received`, {
      sessionID,
      agent,
      resolvedAgent,
      statusCode: extractStatusCode(error, config.retry_on_errors),
      errorName: extractErrorName(error),
      errorType: classifyErrorType(error),
    })

    if (!isRetryableError(error, config.retry_on_errors)) {
      log(`[${HOOK_NAME}] Error not retryable, skipping fallback`, {
        sessionID,
        retryable: false,
        statusCode: extractStatusCode(error, config.retry_on_errors),
        errorName: extractErrorName(error),
        errorType: classifyErrorType(error),
      })
      return
    }

    let state = sessionStates.get(sessionID)
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)

    if (fallbackModels.length === 0) {
      log(`[${HOOK_NAME}] No fallback models configured`, { sessionID, agent })
      return
    }

    if (!state) {
      const initialModel = resolveFallbackBootstrapModel({
        sessionID,
        source: "session.error",
        eventModel: resolveEventModel(props),
        resolvedAgent,
        pluginConfig,
      })
      if (!initialModel) {
        log(`[${HOOK_NAME}] No model info available, cannot fallback`, { sessionID })
        return
      }

      state = createFallbackState(initialModel)
      sessionStates.set(sessionID, state)
      sessionLastAccess.set(sessionID, Date.now())
    } else {
      sessionLastAccess.set(sessionID, Date.now())
    }

    await dispatchFallbackRetry(deps, helpers, {
      sessionID,
      state,
      fallbackModels,
      resolvedAgent,
      source: "session.error",
    })
  }

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (!config.enabled) return

    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") { handleSessionCreated(props); return }
    if (event.type === "session.deleted") { handleSessionDeleted(props); return }
    if (event.type === "session.stop") { await handleSessionStop(props); return }
    if (event.type === "message.updated") { handleMessageUpdated(props); return }
    if (event.type === "session.idle") { handleSessionIdle(props); return }
    if (event.type === "session.status") { await sessionStatusHandler(props); return }
    if (event.type === "session.error") { await handleSessionError(props); return }
  }
}
