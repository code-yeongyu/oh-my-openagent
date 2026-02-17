import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { extractStatusCode, extractErrorName, classifyErrorType, isRetryableError, extractAutoRetrySignal } from "./error-classifier"
import { createFallbackState, prepareFallback } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"

export function hasVisibleAssistantResponse(extractAutoRetrySignalFn: typeof extractAutoRetrySignal) {
  return async (
    ctx: HookDeps["ctx"],
    sessionID: string,
    _info: Record<string, unknown> | undefined,
  ): Promise<boolean> => {
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })

      const msgs = (messagesResp as {
        data?: Array<{
          info?: Record<string, unknown>
          parts?: Array<{ type?: string; text?: string }>
        }>
      }).data

      if (!msgs || msgs.length === 0) return false

      const lastAssistant = [...msgs].reverse().find((m) => m.info?.role === "assistant")
      if (!lastAssistant) return false
      if (lastAssistant.info?.error) return false

      const parts = lastAssistant.parts ??
        (lastAssistant.info?.parts as Array<{ type?: string; text?: string }> | undefined)

      const textFromParts = (parts ?? [])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text!.trim())
        .filter((text) => text.length > 0)
        .join("\n")

      if (!textFromParts) return false
      if (extractAutoRetrySignalFn({ message: textFromParts })) return false

      return true
    } catch {
      return false
    }
  }
}

export function createMessageUpdateHandler(deps: HookDeps, helpers: AutoRetryHelpers) {
  const { ctx, config, pluginConfig, sessionStates, sessionLastAccess, sessionRetryInFlight, sessionAwaitingFallbackResult } = deps
  const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal)

  return async (props: Record<string, unknown> | undefined) => {
    const info = props?.info as Record<string, unknown> | undefined
    const sessionID = info?.sessionID as string | undefined
    const retrySignalResult = extractAutoRetrySignal(info)
    const retrySignal = retrySignalResult?.signal
    const timeoutEnabled = config.timeout_seconds > 0
    const error = info?.error ?? (retrySignal && timeoutEnabled ? { name: "ProviderRateLimitError", message: retrySignal } : undefined)
    const role = info?.role as string | undefined
    const model = info?.model as string | undefined

    if (sessionID && role === "assistant" && !error) {
      if (!sessionAwaitingFallbackResult.has(sessionID)) {
        return
      }

      const hasVisible = await checkVisibleResponse(ctx, sessionID, info)
      if (!hasVisible) {
        log(`[${HOOK_NAME}] Assistant update observed without visible final response; keeping fallback timeout`, {
          sessionID,
          model,
        })
        return
      }

      sessionAwaitingFallbackResult.delete(sessionID)
      helpers.clearSessionFallbackTimeout(sessionID)
      const state = sessionStates.get(sessionID)
      if (state?.pendingFallbackModel) {
        state.pendingFallbackModel = undefined
      }
      log(`[${HOOK_NAME}] Assistant response observed; cleared fallback timeout`, { sessionID, model })
      return
    }

    if (sessionID && role === "assistant" && error) {
      sessionAwaitingFallbackResult.delete(sessionID)
      if (sessionRetryInFlight.has(sessionID) && !retrySignal) {
        log(`[${HOOK_NAME}] message.updated fallback skipped (retry in flight)`, { sessionID })
        return
      }

      if (retrySignal && sessionRetryInFlight.has(sessionID) && timeoutEnabled) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to provider auto-retry signal`, {
          sessionID,
          model,
        })
        await helpers.abortSessionRequest(sessionID, "message.updated.retry-signal")
        sessionRetryInFlight.delete(sessionID)
      }

      if (retrySignal && timeoutEnabled) {
        log(`[${HOOK_NAME}] Detected provider auto-retry signal`, { sessionID, model })
      }

      if (!retrySignal) {
        helpers.clearSessionFallbackTimeout(sessionID)
      }

      log(`[${HOOK_NAME}] message.updated with assistant error`, {
        sessionID,
        model,
        statusCode: extractStatusCode(error, config.retry_on_errors),
        errorName: extractErrorName(error),
        errorType: classifyErrorType(error),
      })

      if (!isRetryableError(error, config.retry_on_errors)) {
        log(`[${HOOK_NAME}] message.updated error not retryable, skipping fallback`, {
          sessionID,
          statusCode: extractStatusCode(error, config.retry_on_errors),
          errorName: extractErrorName(error),
          errorType: classifyErrorType(error),
        })
        return
      }

      let state = sessionStates.get(sessionID)
      const agent = info?.agent as string | undefined
      const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)

      if (fallbackModels.length === 0) {
        return
      }

      if (!state) {
        let initialModel = model
        if (!initialModel) {
          const detectedAgent = resolvedAgent
          const agentConfig = detectedAgent
            ? pluginConfig?.agents?.[detectedAgent as keyof typeof pluginConfig.agents]
            : undefined
          const agentModel = agentConfig?.model as string | undefined
          if (agentModel) {
            log(`[${HOOK_NAME}] Derived model from agent config for message.updated`, {
              sessionID,
              agent: detectedAgent,
              model: agentModel,
            })
            initialModel = agentModel
          }
        }

        if (!initialModel) {
          log(`[${HOOK_NAME}] message.updated missing model info, cannot fallback`, {
            sessionID,
            errorName: extractErrorName(error),
            errorType: classifyErrorType(error),
          })
          return
        }

        state = createFallbackState(initialModel)
        sessionStates.set(sessionID, state)
        sessionLastAccess.set(sessionID, Date.now())
      } else {
        sessionLastAccess.set(sessionID, Date.now())

        if (state.pendingFallbackModel) {
          if (retrySignal && timeoutEnabled) {
            log(`[${HOOK_NAME}] Clearing pending fallback due to provider auto-retry signal`, {
              sessionID,
              pendingFallbackModel: state.pendingFallbackModel,
            })
            state.pendingFallbackModel = undefined
          } else {
          log(`[${HOOK_NAME}] message.updated fallback skipped (pending fallback in progress)`, {
            sessionID,
            pendingFallbackModel: state.pendingFallbackModel,
          })
          return
          }
        }
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
        await helpers.autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "message.updated")
      }
    }
  }
}
