import { isSessionActive } from "../../shared/session-idle-settle"
import { createAutoRetryHelpers } from "./auto-retry"
import { createChatMessageHandler } from "./chat-message-handler"
import { DEFAULT_CONFIG } from "./constants"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"
import { clearAllInternalAbortOwnership } from "./internal-abort-ownership"
import { createMessageUpdateHandler } from "./message-update-handler"
import type { HookDeps, RuntimeFallbackHook, RuntimeFallbackInterval, RuntimeFallbackOptions, RuntimeFallbackPluginInput, RuntimeFallbackTimeout } from "./types"

declare function setInterval(callback: () => void, delay?: number): RuntimeFallbackInterval
declare function clearInterval(interval: RuntimeFallbackInterval): void
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

type RuntimeFallbackHookFactories = {
  createAutoRetryHelpers: typeof createAutoRetryHelpers
  createEventHandler: typeof createEventHandler
  createMessageUpdateHandler: typeof createMessageUpdateHandler
  createChatMessageHandler: typeof createChatMessageHandler
  createFirstPromptWatchdog: typeof createFirstPromptWatchdog
}

const defaultRuntimeFallbackHookFactories: RuntimeFallbackHookFactories = {
  createAutoRetryHelpers,
  createEventHandler,
  createMessageUpdateHandler,
  createChatMessageHandler,
  createFirstPromptWatchdog,
}

async function isCurrentRequestActive(ctx: RuntimeFallbackPluginInput, sessionID: string): Promise<boolean> {
  const status = ctx.client.session.status
  if (!status) return false
  return isSessionActive({
    session: {
      status: () => status({ query: { directory: ctx.directory } }),
    },
  }, sessionID)
}

export function createRuntimeFallbackHook(
  ctx: RuntimeFallbackPluginInput,
  options?: RuntimeFallbackOptions,
  factoryOverrides: Partial<RuntimeFallbackHookFactories> = {},
): RuntimeFallbackHook {
  let disposed = false
  const factories = {
    ...defaultRuntimeFallbackHookFactories,
    ...factoryOverrides,
  }
  const config = {
    enabled: options?.config?.enabled ?? DEFAULT_CONFIG.enabled,
    retry_on_errors: options?.config?.retry_on_errors ?? DEFAULT_CONFIG.retry_on_errors,
    max_fallback_attempts: options?.config?.max_fallback_attempts ?? DEFAULT_CONFIG.max_fallback_attempts,
    cooldown_seconds: options?.config?.cooldown_seconds ?? DEFAULT_CONFIG.cooldown_seconds,
    timeout_seconds: options?.config?.timeout_seconds ?? DEFAULT_CONFIG.timeout_seconds,
    notify_on_fallback: options?.config?.notify_on_fallback ?? DEFAULT_CONFIG.notify_on_fallback,
    restore_primary_after_cooldown: options?.config?.restore_primary_after_cooldown ?? DEFAULT_CONFIG.restore_primary_after_cooldown,
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
    internallyAbortedSessions: new Set(),
    isLifecycleActive: () => !disposed,
  }

  const helpers = factories.createAutoRetryHelpers(deps)
  const baseEventHandler = factories.createEventHandler(deps, helpers)
  const messageUpdateHandler = factories.createMessageUpdateHandler(deps, helpers)
  const chatMessageHandler = factories.createChatMessageHandler(deps)
  const firstPromptWatchdog = factories.createFirstPromptWatchdog(deps, helpers)
  const deferredTerminalEvents = new Map<string, { type: string; properties?: unknown }>()

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
    if (disposed) return
    ensureInterval()

    let watchdogDecision: ReturnType<typeof observeEventForWatchdog>
    if (config.enabled) {
      watchdogDecision = observeEventForWatchdog(event, firstPromptWatchdog)
    }

    if (watchdogDecision?.kind === "defer-terminal") {
      deferredTerminalEvents.set(watchdogDecision.sessionID, event)
      return
    }
    if (watchdogDecision?.kind === "consume-terminal") return
    if (watchdogDecision?.kind === "inspect-terminal") {
      const currentRequestActive = await isCurrentRequestActive(ctx, watchdogDecision.sessionID)
      if (disposed) return
      watchdogDecision = firstPromptWatchdog.resolveDeferredTerminal(
        watchdogDecision.sessionID,
        currentRequestActive,
      )
    }
    if (watchdogDecision?.kind === "resolve-terminal") {
      const deferredEvent = deferredTerminalEvents.get(watchdogDecision.sessionID)
      deferredTerminalEvents.delete(watchdogDecision.sessionID)
      if (deferredEvent) {
        await baseEventHandler({ event: deferredEvent })
      }
    }

    if (event.type === "message.updated") {
      if (!config.enabled) return
      const props = event.properties as Record<string, unknown> | undefined
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = typeof info?.sessionID === "string" ? info.sessionID : undefined
      const awaitingFallback = sessionID !== undefined && deps.sessionAwaitingFallbackResult.has(sessionID)
      await messageUpdateHandler(props)
      if (
        awaitingFallback
        && sessionID !== undefined
        && info?.role === "assistant"
        && info.error === undefined
        && !deps.sessionAwaitingFallbackResult.has(sessionID)
      ) firstPromptWatchdog.onFallbackCompleted(sessionID)
      return
    }
    await baseEventHandler({ event })
  }

  const dispose = () => {
    disposed = true
    if (cleanupInterval) {
      clearInterval(cleanupInterval)
    }

    for (const fallbackTimeout of deps.sessionFallbackTimeouts.values()) {
      clearTimeout(fallbackTimeout)
    }

    firstPromptWatchdog.dispose()
    deferredTerminalEvents.clear()

    deps.sessionStates.clear()
    deps.sessionLastAccess.clear()
    deps.sessionRetryInFlight.clear()
    deps.sessionAwaitingFallbackResult.clear()
    deps.sessionFallbackTimeouts.clear()
    deps.sessionStatusRetryKeys.clear()
    deps.internalAbortRequests?.clear()
    clearAllInternalAbortOwnership(deps)
  }

  return {
    event: eventHandler,
    "chat.message": async (input, output) => {
      if (disposed) return
      await chatMessageHandler(input, output)
    },
    dispose,
  } as RuntimeFallbackHook
}
