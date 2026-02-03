import type { PluginInput } from "@opencode-ai/plugin"
import type { RuntimeFallbackConfig, OhMyOpenCodeConfig } from "../../config"
import type { FallbackState, FallbackResult, RuntimeFallbackHook } from "./types"
import { DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS, HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    lastFallbackTime: 0,
    failedModels: new Set<string>(),
    attemptCount: 0,
    pendingFallbackModel: undefined,
  }
}

function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [
    errorObj.data,
    errorObj.error,
    errorObj,
    (errorObj.data as Record<string, unknown>)?.error,
  ]

  for (const obj of paths) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

function extractStatusCode(error: unknown): number | undefined {
  if (!error) return undefined

  const errorObj = error as Record<string, unknown>

  const statusCode = errorObj.statusCode ?? errorObj.status ?? (errorObj.data as Record<string, unknown>)?.statusCode
  if (typeof statusCode === "number") {
    return statusCode
  }

  const message = getErrorMessage(error)
  const statusMatch = message.match(/\b(429|503|529)\b/)
  if (statusMatch) {
    return parseInt(statusMatch[1], 10)
  }

  return undefined
}

function isRetryableError(error: unknown, retryOnErrors: number[]): boolean {
  const statusCode = extractStatusCode(error)

  if (statusCode && retryOnErrors.includes(statusCode)) {
    return true
  }

  const message = getErrorMessage(error)
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function normalizeFallbackModels(models: string | string[] | undefined): string[] {
  if (!models) return []
  const list = Array.isArray(models) ? models : [models]
  return list.filter((m): m is string => typeof m === "string" && m.length > 0)
}

function getFallbackModelsForSession(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined
): string[] {
  if (!pluginConfig) return []

  //#when - session has category from delegate_task, try category fallback_models first
  const sessionCategory = SessionCategoryRegistry.get(sessionID)
  if (sessionCategory && pluginConfig.categories?.[sessionCategory]) {
    const categoryConfig = pluginConfig.categories[sessionCategory]
    if (categoryConfig?.fallback_models) {
      return normalizeFallbackModels(categoryConfig.fallback_models)
    }
  }

  const tryGetFallbackFromAgent = (agentName: string): string[] | undefined => {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (!agentConfig) return undefined
    
    if (agentConfig?.fallback_models) {
      return normalizeFallbackModels(agentConfig.fallback_models)
    }
    
    const agentCategory = agentConfig?.category
    if (agentCategory && pluginConfig.categories?.[agentCategory]) {
      const categoryConfig = pluginConfig.categories[agentCategory]
      if (categoryConfig?.fallback_models) {
        return normalizeFallbackModels(categoryConfig.fallback_models)
      }
    }
    
    return undefined
  }

  if (agent) {
    const result = tryGetFallbackFromAgent(agent)
    if (result) return result
  }

  const sessionAgentMatch = sessionID.match(/\b(sisyphus|oracle|librarian|explore|prometheus|atlas|metis|momus|hephaestus|sisyphus-junior|build|plan|multimodal-looker)\b/i)
  if (sessionAgentMatch) {
    const detectedAgent = sessionAgentMatch[1].toLowerCase()
    const result = tryGetFallbackFromAgent(detectedAgent)
    if (result) return result
  }

  return []
}

function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  if (!state.failedModels.has(model)) return false

  const cooldownMs = cooldownSeconds * 1000
  const timeSinceLastFallback = Date.now() - state.lastFallbackTime

  return timeSinceLastFallback < cooldownMs
}

function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number
): string | undefined {
  for (let i = state.fallbackIndex + 1; i < fallbackModels.length; i++) {
    const candidate = fallbackModels[i]
    if (!isModelInCooldown(candidate, state, cooldownSeconds)) {
      return candidate
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
  }
  return undefined
}

function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>
): FallbackResult {
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  const nextModel = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds)

  if (!nextModel) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextModel,
    attempt: state.attemptCount + 1,
  })

  state.fallbackIndex = fallbackModels.indexOf(nextModel)
  state.failedModels.add(state.currentModel)
  state.lastFallbackTime = Date.now()
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel }
}

export type { RuntimeFallbackHook, RuntimeFallbackOptions } from "./types"

export function createRuntimeFallbackHook(
  ctx: PluginInput,
  options?: { config?: RuntimeFallbackConfig }
): RuntimeFallbackHook {
  const config: Required<RuntimeFallbackConfig> = {
    enabled: options?.config?.enabled ?? DEFAULT_CONFIG.enabled,
    retry_on_errors: options?.config?.retry_on_errors ?? DEFAULT_CONFIG.retry_on_errors,
    max_fallback_attempts: options?.config?.max_fallback_attempts ?? DEFAULT_CONFIG.max_fallback_attempts,
    cooldown_seconds: options?.config?.cooldown_seconds ?? DEFAULT_CONFIG.cooldown_seconds,
    notify_on_fallback: options?.config?.notify_on_fallback ?? DEFAULT_CONFIG.notify_on_fallback,
  }

  const sessionStates = new Map<string, FallbackState>()

  let pluginConfig: OhMyOpenCodeConfig | undefined
  try {
    const { loadPluginConfig } = require("../../plugin-config")
    pluginConfig = loadPluginConfig(ctx.directory, ctx)
  } catch {
    log(`[${HOOK_NAME}] Plugin config not available`)
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (!config.enabled) return

    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionInfo = props?.info as { id?: string; model?: string } | undefined
      const sessionID = sessionInfo?.id
      const model = sessionInfo?.model

      if (sessionID && model) {
        log(`[${HOOK_NAME}] Session created with model`, { sessionID, model })
        sessionStates.set(sessionID, createFallbackState(model))
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      const sessionID = sessionInfo?.id

      if (sessionID) {
        log(`[${HOOK_NAME}] Cleaning up session state`, { sessionID })
        sessionStates.delete(sessionID)
      }
      return
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      const error = props?.error
      const agent = props?.agent as string | undefined

      if (!sessionID) {
        log(`[${HOOK_NAME}] session.error without sessionID, skipping`)
        return
      }

      log(`[${HOOK_NAME}] session.error received`, { sessionID, agent, statusCode: extractStatusCode(error) })

      if (!isRetryableError(error, config.retry_on_errors)) {
        log(`[${HOOK_NAME}] Error not retryable, skipping fallback`, { sessionID })
        return
      }

      let state = sessionStates.get(sessionID)
      const fallbackModels = getFallbackModelsForSession(sessionID, agent, pluginConfig)

      if (fallbackModels.length === 0) {
        log(`[${HOOK_NAME}] No fallback models configured`, { sessionID, agent })
        return
      }

      if (!state) {
        const currentModel = props?.model as string | undefined
        if (currentModel) {
          state = createFallbackState(currentModel)
          sessionStates.set(sessionID, state)
        } else {
          log(`[${HOOK_NAME}] No model info available, cannot fallback`, { sessionID })
          return
        }
      }

      const result = prepareFallback(sessionID, state, fallbackModels, config)

      if (result.success && config.notify_on_fallback) {
        await ctx.client.tui
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

      if (!result.success) {
        log(`[${HOOK_NAME}] Fallback preparation failed`, { sessionID, error: result.error })
      }

      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const error = info?.error
      const role = info?.role as string | undefined
      const model = info?.model as string | undefined

      if (sessionID && role === "assistant" && error && model) {
        log(`[${HOOK_NAME}] message.updated with assistant error`, { sessionID, model })

        if (!isRetryableError(error, config.retry_on_errors)) {
          return
        }

        let state = sessionStates.get(sessionID)
        const agent = info?.agent as string | undefined
        const fallbackModels = getFallbackModelsForSession(sessionID, agent, pluginConfig)

        if (fallbackModels.length === 0) {
          return
        }

        if (!state) {
          state = createFallbackState(model)
          sessionStates.set(sessionID, state)
        }

        const result = prepareFallback(sessionID, state, fallbackModels, config)

        if (result.success && config.notify_on_fallback) {
          await ctx.client.tui
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
      }
      return
    }
  }

  const chatMessageHandler = async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: { message: { model?: { providerID: string; modelID: string } }; parts?: Array<{ type: string; text?: string }> }
  ) => {
    if (!config.enabled) return

    const { sessionID } = input
    const state = sessionStates.get(sessionID)

    if (!state?.pendingFallbackModel) return

    const fallbackModel = state.pendingFallbackModel
    state.pendingFallbackModel = undefined

    log(`[${HOOK_NAME}] Applying fallback model for next request`, {
      sessionID,
      from: input.model,
      to: fallbackModel,
    })

    if (output.message && fallbackModel) {
      const parts = fallbackModel.split("/")
      if (parts.length >= 2) {
        output.message.model = {
          providerID: parts[0],
          modelID: parts.slice(1).join("/"),
        }
      }
    }
  }

  return {
    event: eventHandler,
    "chat.message": chatMessageHandler,
  } as RuntimeFallbackHook
}
