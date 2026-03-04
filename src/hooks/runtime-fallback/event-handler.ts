import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { extractStatusCode, extractErrorName, classifyErrorType, isRetryableError, extractAutoRetrySignal } from "./error-classifier"
import { createFallbackState, prepareFallback } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

export function createEventHandler(deps: HookDeps, helpers: AutoRetryHelpers) {
  const { config, pluginConfig, sessionStates, sessionLastAccess, sessionRetryInFlight, sessionAwaitingFallbackResult, sessionFallbackTimeouts } = deps
  const sessionStatusRetryKeys = new Map<string, string>()

  const handleSessionCreated = (props: Record<string, unknown> | undefined) => {
    const sessionInfo = props?.info as { id?: string; model?: string } | undefined
    const sessionID = sessionInfo?.id
    const model = sessionInfo?.model

    if (sessionID && model) {
      log(`[${HOOK_NAME}] Session created with model`, { sessionID, model })
      sessionStates.set(sessionID, createFallbackState(model))
      sessionLastAccess.set(sessionID, Date.now())
    }
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
      sessionStatusRetryKeys.delete(sessionID)
      SessionCategoryRegistry.remove(sessionID)
    }
  }

  const handleSessionStop = async (props: Record<string, unknown> | undefined) => {
    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    helpers.clearSessionFallbackTimeout(sessionID)

    if (sessionRetryInFlight.has(sessionID) || sessionAwaitingFallbackResult.has(sessionID)) {
      await helpers.abortSessionRequest(sessionID, "session.stop")
    }

    sessionRetryInFlight.delete(sessionID)
    sessionAwaitingFallbackResult.delete(sessionID)

    const state = sessionStates.get(sessionID)
    if (state?.pendingFallbackModel) {
      state.pendingFallbackModel = undefined
    }

    log(`[${HOOK_NAME}] Cleared fallback retry state on session.stop`, { sessionID })
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

  const handleSessionError = async (props: Record<string, unknown> | undefined) => {
    const sessionID = props?.sessionID as string | undefined
    const error = props?.error
    const agent = props?.agent as string | undefined

    if (!sessionID) {
      log(`[${HOOK_NAME}] session.error without sessionID, skipping`)
      return
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)

    if (sessionRetryInFlight.has(sessionID)) {
      log(`[${HOOK_NAME}] session.error skipped — retry in flight`, {
        sessionID,
        retryInFlight: true,
      })
      return
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
          log(`[${HOOK_NAME}] No model info available, cannot fallback`, { sessionID })
          return
        }
      }
    } else {
      sessionLastAccess.set(sessionID, Date.now())
    }

    const result = prepareFallback(sessionID, state, fallbackModels, config)

    if (result.success && config.notify_on_fallback) {
      await deps.ctx.client.tui
        .showToast({
          body: {
            title: "Model Fallback",
            message: `Switching to ${result.newModel?.split("/").pop() || result.newModel} for next request`,
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

  const normalizeRetryStatusMessage = (message: string): string =>
    message
      .replace(/\[retrying in [^\]]*attempt\s*#\d+\]/gi, "[retrying]")
      .replace(/retrying in\s+[^(]*attempt\s*#\d+/gi, "retrying")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()

  const extractRetryAttempt = (statusAttempt: unknown, message: string): string => {
    if (typeof statusAttempt === "number" && Number.isFinite(statusAttempt)) {
      return String(statusAttempt)
    }
    const match = message.match(/attempt\s*#\s*(\d+)/i)
    return match?.[1] ?? "?"
  }

  const handleSessionStatus = async (props: Record<string, unknown> | undefined) => {
    const sessionID = props?.sessionID as string | undefined
    const status = props?.status as { type?: string; message?: string; attempt?: number } | undefined
    const agent = props?.agent as string | undefined
    const model = props?.model as string | undefined

    if (!sessionID || status?.type !== "retry") return

    const retryMessage = typeof status.message === "string" ? status.message : ""
    const retrySignal = extractAutoRetrySignal({ status: retryMessage, message: retryMessage })
    if (!retrySignal) return

    const retryKey = `${extractRetryAttempt(status.attempt, retryMessage)}:${normalizeRetryStatusMessage(retryMessage)}`
    if (sessionStatusRetryKeys.get(sessionID) === retryKey) {
      return
    }
    sessionStatusRetryKeys.set(sessionID, retryKey)

    if (sessionRetryInFlight.has(sessionID)) {
      log(`[${HOOK_NAME}] session.status retry skipped — retry already in flight`, { sessionID })
      return
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
    if (fallbackModels.length === 0) return

    let state = sessionStates.get(sessionID)
    if (!state) {
      const detectedAgent = resolvedAgent
      const agentConfig = detectedAgent
        ? pluginConfig?.agents?.[detectedAgent as keyof typeof pluginConfig.agents]
        : undefined
      const inferredModel = model || (agentConfig?.model as string | undefined)
      if (!inferredModel) {
        log(`[${HOOK_NAME}] session.status retry missing model info, cannot fallback`, { sessionID })
        return
      }
      state = createFallbackState(inferredModel)
      sessionStates.set(sessionID, state)
    }
    sessionLastAccess.set(sessionID, Date.now())

    if (state.pendingFallbackModel) {
      log(`[${HOOK_NAME}] session.status retry skipped (pending fallback in progress)`, {
        sessionID,
        pendingFallbackModel: state.pendingFallbackModel,
      })
      return
    }

    log(`[${HOOK_NAME}] Detected provider auto-retry signal in session.status`, {
      sessionID,
      model: state.currentModel,
      retryAttempt: status.attempt,
    })

    await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")

    const result = prepareFallback(sessionID, state, fallbackModels, config)
    if (result.success && config.notify_on_fallback) {
      await deps.ctx.client.tui
        .showToast({
          body: {
            title: "Model Fallback",
            message: `Switching to ${result.newModel?.split("/").pop() || result.newModel} for next request`,
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {})
    }

    if (result.success && result.newModel) {
      await helpers.autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.status")
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
    if (event.type === "session.stop") { await handleSessionStop(props); return }
    if (event.type === "session.idle") { handleSessionIdle(props); return }
    if (event.type === "session.status") { await handleSessionStatus(props); return }
    if (event.type === "session.error") { await handleSessionError(props); return }
  }
}
