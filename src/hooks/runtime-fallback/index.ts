import type { PluginInput } from "@opencode-ai/plugin"
import type { RuntimeFallbackConfig, OhMyOpenCodeConfig } from "../../config"
import type { FallbackState, FallbackResult, RuntimeFallbackHook, RuntimeFallbackOptions } from "./types"
import { DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS, HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { normalizeFallbackModels } from "../../shared/model-resolver"
import { getSessionAgent } from "../../features/claude-code-session-state"

function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
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
  const statusMatch = message.match(/\b(400|402|429|503|529)\b/)
  if (statusMatch) {
    return parseInt(statusMatch[1], 10)
  }

  return undefined
}

function isRetryableError(error: unknown, retryOnErrors: number[]): boolean {
  const statusCode = extractStatusCode(error)
  const message = getErrorMessage(error)

  if (statusCode && retryOnErrors.includes(statusCode)) {
    return true
  }

  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

const AGENT_NAMES = [
  "sisyphus",
  "oracle",
  "librarian",
  "explore",
  "prometheus",
  "atlas",
  "metis",
  "momus",
  "hephaestus",
  "sisyphus-junior",
  "build",
  "plan",
  "multimodal-looker",
]

const agentPattern = new RegExp(
  `\\b(${AGENT_NAMES
    .sort((a, b) => b.length - a.length)
    .map((a) => a.replace(/-/g, "\\-"))
    .join("|")})\\b`,
  "i",
)

function detectAgentFromSession(sessionID: string): string | undefined {
  const match = sessionID.match(agentPattern)
  if (match) {
    return match[1].toLowerCase()
  }
  return undefined
}

function normalizeAgentName(agent: string | undefined): string | undefined {
  if (!agent) return undefined
  const normalized = agent.toLowerCase().trim()
  if (AGENT_NAMES.includes(normalized)) {
    return normalized
  }
  const match = normalized.match(agentPattern)
  if (match) {
    return match[1].toLowerCase()
  }
  return undefined
}

function resolveAgentForSession(sessionID: string, eventAgent?: string): string | undefined {
  return (
    normalizeAgentName(eventAgent) ??
    normalizeAgentName(getSessionAgent(sessionID)) ??
    detectAgentFromSession(sessionID)
  )
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
      return normalizeFallbackModels(categoryConfig.fallback_models) ?? []
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

  const sessionAgentMatch = sessionID.match(agentPattern)
  if (sessionAgentMatch) {
    const detectedAgent = sessionAgentMatch[1].toLowerCase()
    const result = tryGetFallbackFromAgent(detectedAgent)
    if (result) return result
  }

  // Fallback: if no agent detected, try main agent "sisyphus" then any agent with fallback_models
  const sisyphusFallback = tryGetFallbackFromAgent("sisyphus")
  if (sisyphusFallback) {
    log(`[${HOOK_NAME}] Using sisyphus fallback models (no agent detected)`, { sessionID })
    return sisyphusFallback
  }

  // Last resort: try all known agents until we find one with fallback_models
  for (const agentName of AGENT_NAMES) {
    const result = tryGetFallbackFromAgent(agentName)
    if (result) {
      log(`[${HOOK_NAME}] Using ${agentName} fallback models (no agent detected)`, { sessionID })
      return result
    }
  }

  return []
}

function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  const failedAt = state.failedModels.get(model)
  if (failedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  return Date.now() - failedAt < cooldownMs
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

  const failedModel = state.currentModel
  const now = Date.now()

  state.fallbackIndex = fallbackModels.indexOf(nextModel)
  state.failedModels.set(failedModel, now)
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel }
}

export type { RuntimeFallbackHook, RuntimeFallbackOptions } from "./types"

export function createRuntimeFallbackHook(
  ctx: PluginInput,
  options?: RuntimeFallbackOptions
): RuntimeFallbackHook {
  const config: Required<RuntimeFallbackConfig> = {
    enabled: options?.config?.enabled ?? DEFAULT_CONFIG.enabled,
    retry_on_errors: options?.config?.retry_on_errors ?? DEFAULT_CONFIG.retry_on_errors,
    max_fallback_attempts: options?.config?.max_fallback_attempts ?? DEFAULT_CONFIG.max_fallback_attempts,
    cooldown_seconds: options?.config?.cooldown_seconds ?? DEFAULT_CONFIG.cooldown_seconds,
    notify_on_fallback: options?.config?.notify_on_fallback ?? DEFAULT_CONFIG.notify_on_fallback,
  }

  const sessionStates = new Map<string, FallbackState>()
  const sessionLastAccess = new Map<string, number>()
  const sessionRetryInFlight = new Set<string>()
  const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes TTL for stale sessions

  // Periodic cleanup of stale session states to prevent memory leaks
  const cleanupStaleSessions = () => {
    const now = Date.now()
    let cleanedCount = 0
    for (const [sessionID, lastAccess] of sessionLastAccess.entries()) {
      if (now - lastAccess > SESSION_TTL_MS) {
        sessionStates.delete(sessionID)
        sessionLastAccess.delete(sessionID)
        sessionRetryInFlight.delete(sessionID)
        SessionCategoryRegistry.remove(sessionID)
        cleanedCount++
      }
    }
    if (cleanedCount > 0) {
      log(`[${HOOK_NAME}] Cleaned up ${cleanedCount} stale session states`)
    }
  }

  // Run cleanup every 5 minutes
  const cleanupInterval = setInterval(cleanupStaleSessions, 5 * 60 * 1000)

  let pluginConfig: OhMyOpenCodeConfig | undefined
  if (options?.pluginConfig) {
    pluginConfig = options.pluginConfig
  } else {
    try {
      const { loadPluginConfig } = require("../../plugin-config")
      pluginConfig = loadPluginConfig(ctx.directory, ctx)
    } catch {
      log(`[${HOOK_NAME}] Plugin config not available`)
    }
  }

  const autoRetryWithFallback = async (
    sessionID: string,
    newModel: string,
    resolvedAgent: string | undefined,
    source: string,
  ): Promise<void> => {
    if (sessionRetryInFlight.has(sessionID)) {
      log(`[${HOOK_NAME}] Retry already in flight, skipping (${source})`, { sessionID })
      return
    }

    const modelParts = newModel.split("/")
    if (modelParts.length < 2) return

    const fallbackModelObj = {
      providerID: modelParts[0],
      modelID: modelParts.slice(1).join("/"),
    }

    sessionRetryInFlight.add(sessionID)
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
      const lastUserMsg = msgs?.filter((m) => m.info?.role === "user").pop()
      const lastUserPartsRaw =
        lastUserMsg?.parts ??
        (lastUserMsg?.info?.parts as Array<{ type?: string; text?: string }> | undefined)

      if (lastUserPartsRaw && lastUserPartsRaw.length > 0) {
        log(`[${HOOK_NAME}] Auto-retrying with fallback model (${source})`, {
          sessionID,
          model: newModel,
        })

        const retryParts = lastUserPartsRaw
          .filter((p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0)
          .map((p) => ({ type: "text" as const, text: p.text! }))

        if (retryParts.length > 0) {
          const retryAgent = resolvedAgent ?? getSessionAgent(sessionID)
          await ctx.client.session.promptAsync({
            path: { id: sessionID },
            body: {
              ...(retryAgent ? { agent: retryAgent } : {}),
              model: fallbackModelObj,
              parts: retryParts,
            },
            query: { directory: ctx.directory },
          })
        }
      } else {
        log(`[${HOOK_NAME}] No user message found for auto-retry (${source})`, { sessionID })
      }
    } catch (retryError) {
      log(`[${HOOK_NAME}] Auto-retry failed (${source})`, { sessionID, error: String(retryError) })
    } finally {
      sessionRetryInFlight.delete(sessionID)
    }
  }

  const resolveAgentForSessionFromContext = async (
    sessionID: string,
    eventAgent?: string,
  ): Promise<string | undefined> => {
    const resolved = resolveAgentForSession(sessionID, eventAgent)
    if (resolved) return resolved

    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const msgs = (messagesResp as { data?: Array<{ info?: Record<string, unknown> }> }).data
      if (!msgs || msgs.length === 0) return undefined

      for (let i = msgs.length - 1; i >= 0; i--) {
        const info = msgs[i]?.info
        const infoAgent = typeof info?.agent === "string" ? info.agent : undefined
        const normalized = normalizeAgentName(infoAgent)
        if (normalized) {
          return normalized
        }
      }
    } catch {
      return undefined
    }

    return undefined
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
        sessionLastAccess.set(sessionID, Date.now())
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      const sessionID = sessionInfo?.id

      if (sessionID) {
        log(`[${HOOK_NAME}] Cleaning up session state`, { sessionID })
        sessionStates.delete(sessionID)
        sessionLastAccess.delete(sessionID)
        sessionRetryInFlight.delete(sessionID)
        SessionCategoryRegistry.remove(sessionID)
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

      const resolvedAgent = await resolveAgentForSessionFromContext(sessionID, agent)

      log(`[${HOOK_NAME}] session.error received`, {
        sessionID,
        agent,
        resolvedAgent,
        statusCode: extractStatusCode(error),
      })

      if (!isRetryableError(error, config.retry_on_errors)) {
        log(`[${HOOK_NAME}] Error not retryable, skipping fallback`, { sessionID })
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
          // session.error doesn't include model — derive from agent config
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

      if (result.success && result.newModel) {
        await autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.error")
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
        const resolvedAgent = await resolveAgentForSessionFromContext(sessionID, agent)
        const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)

        if (fallbackModels.length === 0) {
          return
        }

        if (!state) {
          state = createFallbackState(model)
          sessionStates.set(sessionID, state)
          sessionLastAccess.set(sessionID, Date.now())
        } else {
          sessionLastAccess.set(sessionID, Date.now())
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

        if (result.success && result.newModel) {
          await autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "message.updated")
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
    let state = sessionStates.get(sessionID)

    if (!state) return

    const requestedModel = input.model
      ? `${input.model.providerID}/${input.model.modelID}`
      : undefined

    if (requestedModel && requestedModel !== state.currentModel) {
      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
      })
      state = createFallbackState(requestedModel)
      sessionStates.set(sessionID, state)
      sessionLastAccess.set(sessionID, Date.now())
      return
    }

    if (state.currentModel === state.originalModel) return

    const activeModel = state.currentModel

    log(`[${HOOK_NAME}] Applying fallback model override`, {
      sessionID,
      from: input.model,
      to: activeModel,
    })

    if (output.message && activeModel) {
      const parts = activeModel.split("/")
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
