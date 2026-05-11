import type { HookDeps, RuntimeFallbackHook, RuntimeFallbackInterval, RuntimeFallbackOptions, RuntimeFallbackPluginInput, RuntimeFallbackTimeout } from "./types"
import { DEFAULT_CONFIG } from "./constants"
import { createAutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createChatMessageHandler } from "./chat-message-handler"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"

declare function setInterval(callback: () => void, delay?: number): RuntimeFallbackInterval
declare function clearInterval(interval: RuntimeFallbackInterval): void
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export function createRuntimeFallbackHook(
  ctx: RuntimeFallbackPluginInput,
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

  const deps: HookDeps = {
    ctx,
    config,
    options,
    pluginConfig: options?.pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
  }

  const helpers = createAutoRetryHelpers(deps)
  const baseEventHandler = createEventHandler(deps, helpers)
  const messageUpdateHandler = createMessageUpdateHandler(deps, helpers)
  const chatMessageHandler = createChatMessageHandler(deps)
  const firstPromptWatchdog = createFirstPromptWatchdog(deps, helpers)

  let cleanupInterval: RuntimeFallbackInterval | null = null
  let intervalStarted = false

  const ensureInterval = (): void => {
    if (intervalStarted) return

    intervalStarted = true
    cleanupInterval = setInterval(helpers.cleanupStaleSessions, 5 * 60 * 1000)

    if (typeof cleanupInterval.unref === "function") {
      cleanupInterval.unref()
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    ensureInterval()

    if (config.enabled) {
      observeEventForWatchdog(event, firstPromptWatchdog)
    }

    if (event.type === "message.updated") {
      if (!config.enabled) return
      const props = event.properties as Record<string, unknown> | undefined
      await messageUpdateHandler(props)
      return
    }
    await baseEventHandler({ event })
  }

  const dispose = () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval)
    }

    for (const fallbackTimeout of deps.sessionFallbackTimeouts.values()) {
      clearTimeout(fallbackTimeout)
    }

    firstPromptWatchdog.dispose()

    deps.sessionStates.clear()
    deps.sessionLastAccess.clear()
    deps.sessionRetryInFlight.clear()
    deps.sessionAwaitingFallbackResult.clear()
    deps.sessionFallbackTimeouts.clear()
    deps.sessionStatusRetryKeys.clear()
  }

  return {
    event: eventHandler,
    "chat.message": chatMessageHandler,
    dispose,
  } as RuntimeFallbackHook
}
