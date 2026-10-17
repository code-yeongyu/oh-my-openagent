import { createAutoRetryHelpers } from "./auto-retry"
import { createChatMessageHandler } from "./chat-message-handler"
import { DEFAULT_CONFIG } from "./constants"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"
import { createMessageUpdateHandler } from "./message-update-handler"
import { resolveSessionEventID } from "../../shared/event-session-id"
import {
  registerRuntimeFallbackRecoveryOwner,
  settleRuntimeFallbackRecoveryClaim,
} from "../../shared/runtime-fallback-recovery"
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

export function createRuntimeFallbackHook(
  ctx: RuntimeFallbackPluginInput,
  options?: RuntimeFallbackOptions,
  factoryOverrides: Partial<RuntimeFallbackHookFactories> = {},
): RuntimeFallbackHook {
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
    deferredSessionErrors: new Map(),
  }

  const helpers = factories.createAutoRetryHelpers(deps)
  const baseEventHandler = factories.createEventHandler(deps, helpers)
  const messageUpdateHandler = factories.createMessageUpdateHandler(deps, helpers)
  const chatMessageHandler = factories.createChatMessageHandler(deps)
  const firstPromptWatchdog = factories.createFirstPromptWatchdog(deps, helpers)

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

  const releaseRecoveryOwner = config.enabled ? registerRuntimeFallbackRecoveryOwner() : () => {}

  // A session.error is recovered here when a retry dispatch is pending or awaiting its result. That covers
  // an accepted retry and an error from a superseded generation that arrives while one is live; an error
  // from the retry itself clears both sets before it is declined.
  const ownsRecovery = (sessionID: string | undefined): boolean =>
    sessionID !== undefined
    && (deps.sessionRetryInFlight.has(sessionID) || deps.sessionAwaitingFallbackResult.has(sessionID))

  const deferredSessionErrors = deps.deferredSessionErrors ?? new Map<string, object[]>()
  const isDeferred = (sessionID: string | undefined, event: object): boolean =>
    sessionID !== undefined && (deferredSessionErrors.get(sessionID)?.includes(event) ?? false)

  // A session.error that arrived while a retry dispatch was in flight was skipped, and its claim waits for that
  // dispatch. An accepted retry owns the error. A refused one leaves nothing recovering, so the claim is declined
  // and the background task ends with this error instead of losing it. If another dispatch has taken the session
  // over by then, that dispatch settles the claim when it finishes.
  deps.onRetryDispatchSettled = (sessionID, accepted) => {
    const events = deferredSessionErrors.get(sessionID)
    if (!events) return
    if (!accepted && deps.sessionRetryInFlight.has(sessionID)) return
    deferredSessionErrors.delete(sessionID)
    for (const event of events) settleRuntimeFallbackRecoveryClaim(event, accepted ? "retry-owned" : "declined")
  }

  const handleEvent = async ({ event }: { event: { type: string; properties?: unknown } }) => {
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

  const eventHandler = async (input: { event: { type: string; properties?: unknown } }) => {
    try {
      await handleEvent(input)
    } finally {
      if (input.event.type === "session.error") {
        const sessionID = resolveSessionEventID(input.event.properties as Record<string, unknown> | undefined)
        if (!isDeferred(sessionID, input.event)) {
          settleRuntimeFallbackRecoveryClaim(input.event, ownsRecovery(sessionID) ? "retry-owned" : "declined")
        }
      }
    }
  }

  const dispose = () => {
    for (const events of deferredSessionErrors.values()) {
      for (const event of events) settleRuntimeFallbackRecoveryClaim(event, "declined")
    }
    deferredSessionErrors.clear()
    releaseRecoveryOwner()
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
    deps.internallyAbortedSessions.clear()
  }

  return {
    event: eventHandler,
    "chat.message": chatMessageHandler,
    dispose,
  } as RuntimeFallbackHook
}
