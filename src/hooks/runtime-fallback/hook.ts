import type { PluginInput } from "@opencode-ai/plugin"
import type { HookDeps, RuntimeFallbackHook, RuntimeFallbackOptions } from "./types"
import { DEFAULT_CONFIG, HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { loadPluginConfig } from "../../plugin-config"
import { createAutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createChatMessageHandler } from "./chat-message-handler"

export function createRuntimeFallbackHook(
  ctx: PluginInput,
  options?: RuntimeFallbackOptions
): RuntimeFallbackHook {
  const config = {
    enabled: options?.config?.enabled ?? DEFAULT_CONFIG.enabled,
    retry_on_errors: options?.config?.retry_on_errors ?? DEFAULT_CONFIG.retry_on_errors,
    max_fallback_attempts: options?.config?.max_fallback_attempts ?? DEFAULT_CONFIG.max_fallback_attempts,
    cooldown_seconds: options?.config?.cooldown_seconds ?? DEFAULT_CONFIG.cooldown_seconds,
    timeout_seconds: options?.config?.timeout_seconds ?? DEFAULT_CONFIG.timeout_seconds,
    notify_on_fallback: options?.config?.notify_on_fallback ?? DEFAULT_CONFIG.notify_on_fallback,
  }

  let pluginConfig = options?.pluginConfig
  if (!pluginConfig) {
    try {
      pluginConfig = loadPluginConfig(ctx.directory, ctx)
    } catch {
      log(`[${HOOK_NAME}] Plugin config not available`)
    }
  }

  const deps: HookDeps = {
    ctx,
    config,
    options,
    pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
  }

  const helpers = createAutoRetryHelpers(deps)
  const baseEventHandler = createEventHandler(deps, helpers)
  const messageUpdateHandler = createMessageUpdateHandler(deps, helpers)
  const chatMessageHandler = createChatMessageHandler(deps)

  const cleanupInterval = setInterval(helpers.cleanupStaleSessions, 5 * 60 * 1000)
  cleanupInterval.unref()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type === "message.updated") {
      if (!config.enabled) return
      const props = event.properties as Record<string, unknown> | undefined
      await messageUpdateHandler(props)
      return
    }
    await baseEventHandler({ event })
  }

  return {
    event: eventHandler,
    "chat.message": chatMessageHandler,
  } as RuntimeFallbackHook
}
