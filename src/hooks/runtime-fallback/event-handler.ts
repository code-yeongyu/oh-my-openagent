import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { extractStatusCode, extractErrorName, classifyErrorType, isRetryableError } from "./error-classifier"
import { createFallbackState, prepareFallback } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

export function createEventHandler(deps: HookDeps, helpers: AutoRetryHelpers) {
  const { config, pluginConfig, sessionStates, sessionLastAccess, sessionRetryInFlight, sessionAwaitingFallbackResult, sessionFallbackTimeouts } = deps

  const handleSessionCreated = (props: Record<string, unknown> | undefined) => {
    const sessionInfo = props?.info as { id?: string } | undefined
    const sessionID = sessionInfo?.id
    if (!sessionID) return

    // SDK Session type has no model/agent fields — state is created on-demand
    // by handleSessionError or handleSessionStatus when the actual model is known
    log(`[${HOOK_NAME}] Session created, state will be created on-demand`, { sessionID })
  }

  const handleSessionDeleted = (props: Record<string, unknown> | undefined) => {
    const sessionInfo = props?.info as { id?: string } | undefined
    const sessionID = sessionInfo?.id

    if (sessionID) {
      log(`[${HOOK_NAME}] Cleaning up session state`, { sessionID })
      sessionStates.delete(sessionID)
      sessionLastAccess.delete(sessionID)
      sessionRetryInFlight.delete(sessionID)
      sessionAwaitingFallbackResult.delete(sessionID)
      helpers.clearSessionFallbackTimeout(sessionID)
      SessionCategoryRegistry.remove(sessionID)
    }
  }

  const handleSessionIdle = (props: Record<string, unknown> | undefined) => {
    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    if (sessionAwaitingFallbackResult.has(sessionID)) {
      log(`[${HOOK_NAME}] session.idle while awaiting fallback result; keeping timeout armed`, { sessionID })
      return
    }

    const hadTimeout = sessionFallbackTimeouts.has(sessionID)
    helpers.clearSessionFallbackTimeout(sessionID)
    sessionRetryInFlight.delete(sessionID)

    const state = sessionStates.get(sessionID)
    if (state?.pendingFallbackModel) {
      state.pendingFallbackModel = undefined
    }

    if (hadTimeout) {
      log(`[${HOOK_NAME}] Cleared fallback timeout after session completion`, { sessionID })
    }
  }

  const handleSessionStatus = async (props: Record<string, unknown> | undefined) => {
    const sessionID = props?.sessionID as string | undefined
    const status = props?.status as { type?: string; attempt?: number; message?: string; next?: number } | undefined
    if (!sessionID || !status || status.type !== "retry") return

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, undefined)
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)

    log(`[${HOOK_NAME}] Provider retry detected`, {
      sessionID, attempt: status.attempt, message: status.message,
      nextRetryMs: status.next, resolvedAgent, totalFallbackModels: fallbackModels.length,
    })

    if (fallbackModels.length === 0) {
      if (config.notify_on_fallback) {
        await deps.ctx.client.tui.showToast({ body: {
          title: "Provider Retrying", variant: "info", duration: 3000,
          message: `${status.message || "retrying..."} (no fallback models configured)`,
        } }).catch(() => {})
      }
      return
    }

    let state = sessionStates.get(sessionID)
    if (!state) {
      const agentConfig = resolvedAgent
        ? pluginConfig?.agents?.[resolvedAgent as keyof typeof pluginConfig.agents] : undefined
      const initialModel = (agentConfig?.model as string | undefined)
        ?? (pluginConfig?.agents?.sisyphus?.model as string | undefined)
      if (!initialModel) {
        log(`[${HOOK_NAME}] No model info for session.status fallback`, { sessionID })
        return
      }
      log(`[${HOOK_NAME}] Creating on-demand state for session.status`, { sessionID, model: initialModel, agent: resolvedAgent })
      state = createFallbackState(initialModel)
      sessionStates.set(sessionID, state)
      sessionLastAccess.set(sessionID, Date.now())
    } else {
      sessionLastAccess.set(sessionID, Date.now())
    }

    sessionAwaitingFallbackResult.delete(sessionID)
    helpers.clearSessionFallbackTimeout(sessionID)

    const result = prepareFallback(sessionID, state, fallbackModels, config)

    if (result.success && config.notify_on_fallback) {
      const modelName = result.newModel?.split("/").pop() || result.newModel
      await deps.ctx.client.tui.showToast({ body: {
        title: "Retry Detected — Switching Model", variant: "warning", duration: 5000,
        message: `${status.message || "Provider retrying"} → ${modelName} (attempt ${state.attemptCount} of ${fallbackModels.length})`,
      } }).catch(() => {})
    }

    if (result.success && result.newModel) {
      await helpers.autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.status")
    } else if (!result.success) {
      log(`[${HOOK_NAME}] session.status fallback failed`, { sessionID, error: result.error })
      if (result.maxAttemptsReached && config.notify_on_fallback) {
        await deps.ctx.client.tui.showToast({ body: {
          title: "All Fallbacks Exhausted", variant: "error", duration: 8000,
          message: `All ${fallbackModels.length} fallback models exhausted after ${state.attemptCount} attempts`,
        } }).catch(() => {})
      }
    }
  }

  const handleSessionError = async (props: Record<string, unknown> | undefined) => {
    const sessionID = props?.sessionID as string | undefined
    const error = props?.error
    const agent = props?.agent as string | undefined

    if (!sessionID) {
      log(`[${HOOK_NAME}] session.error without sessionID, skipping`)
      return
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
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
      const currentModel = props?.model as string | undefined
      if (currentModel) {
        state = createFallbackState(currentModel)
        sessionStates.set(sessionID, state)
        sessionLastAccess.set(sessionID, Date.now())
      } else {
        const detectedAgent = resolvedAgent
        const agentConfig = detectedAgent
          ? pluginConfig?.agents?.[detectedAgent as keyof typeof pluginConfig.agents]
          : undefined
        const agentModel = agentConfig?.model as string | undefined
        if (agentModel) {
          log(`[${HOOK_NAME}] Derived model from agent config`, { sessionID, agent: detectedAgent, model: agentModel })
          state = createFallbackState(agentModel)
          sessionStates.set(sessionID, state)
          sessionLastAccess.set(sessionID, Date.now())
        } else {
          const sisyphusModel = pluginConfig?.agents?.sisyphus?.model as string | undefined
          if (sisyphusModel) {
            log(`[${HOOK_NAME}] Using sisyphus model for state creation (no agent detected)`, { sessionID, model: sisyphusModel })
            state = createFallbackState(sisyphusModel)
            sessionStates.set(sessionID, state)
            sessionLastAccess.set(sessionID, Date.now())
          } else {
            log(`[${HOOK_NAME}] No model info available, cannot fallback`, { sessionID })
            return
          }
        }
      }
    } else {
      sessionLastAccess.set(sessionID, Date.now())
    }

    const result = prepareFallback(sessionID, state, fallbackModels, config)

    if (result.success && config.notify_on_fallback) {
      const modelName = result.newModel?.split("/").pop() || result.newModel
      const attemptInfo = `attempt ${state.attemptCount} of ${fallbackModels.length}`
      await deps.ctx.client.tui
        .showToast({
          body: {
            title: "Model Fallback",
            message: `Switching to ${modelName} (${attemptInfo})`,
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {})
    }

    if (result.success && result.newModel) {
      await helpers.autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.error")
    }

    if (!result.success) {
      log(`[${HOOK_NAME}] Fallback preparation failed`, { sessionID, error: result.error })
    }
  }

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (!config.enabled) return

    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") { handleSessionCreated(props); return }
    if (event.type === "session.deleted") { handleSessionDeleted(props); return }
    if (event.type === "session.idle") { handleSessionIdle(props); return }
    if (event.type === "session.error") { await handleSessionError(props); return }
    if (event.type === "session.status") { await handleSessionStatus(props); return }
  }
}
