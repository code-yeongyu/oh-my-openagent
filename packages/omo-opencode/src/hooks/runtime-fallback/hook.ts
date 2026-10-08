import { createAutoRetryHelpers } from "./auto-retry"
import { createChatMessageHandler } from "./chat-message-handler"
import { COMPACTION_WATCHDOG_BUDGET_MS, DEFAULT_CONFIG } from "./constants"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"
import { createMessageUpdateHandler } from "./message-update-handler"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { clearAllCompactions, getCompaction, observeCompactionEvent } from "../../shared/compaction-in-flight"
import { log } from "../../shared/logger"
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
    fallbackExhaustionToastStates: new Map(),
  }

  const helpers = factories.createAutoRetryHelpers(deps)
  const baseEventHandler = factories.createEventHandler(deps, helpers)
  const messageUpdateHandler = factories.createMessageUpdateHandler(deps, helpers)
  const chatMessageHandler = factories.createChatMessageHandler(deps)
  const firstPromptWatchdog = factories.createFirstPromptWatchdog(deps, helpers)

  let cleanupInterval: RuntimeFallbackInterval | null = null
  let intervalStarted = false
  const lastFallbackProgressRearm = new Map<string, number>()
  const lastEndedRearm = new Map<string, number>()

  const ensureInterval = (): void => {
    if (intervalStarted) return

    intervalStarted = true
    cleanupInterval = setInterval(helpers.cleanupStaleSessions, 5 * 60 * 1000)

    if (typeof cleanupInterval.unref === "function") {
      cleanupInterval.unref()
    }
  }

  const releaseRecoveryOwner = registerRuntimeFallbackRecoveryOwner()

  // A session.error is recovered here when a retry dispatch is pending or awaiting its result. That covers
  // an accepted retry and an error from a superseded generation that arrives while one is live; an error
  // from the retry itself clears both sets before it is declined.
  const ownsRecovery = (sessionID: string | undefined): boolean =>
    sessionID !== undefined
    && (deps.sessionRetryInFlight.has(sessionID) || deps.sessionAwaitingFallbackResult.has(sessionID))

  const handleEvent = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    ensureInterval()
    observeCompactionEvent(event)

    const messageUpdatedInfo = event.type === "message.updated"
      && typeof event.properties === "object"
      && event.properties !== null
      && typeof (event.properties as Record<string, unknown>).info === "object"
      && (event.properties as Record<string, unknown>).info !== null
      ? (event.properties as Record<string, unknown>).info as Record<string, unknown>
      : undefined
    const messageUpdatedEnded = messageUpdatedInfo
      && (messageUpdatedInfo.error !== undefined
        || (typeof messageUpdatedInfo.time === "object"
          && messageUpdatedInfo.time !== null
          && (messageUpdatedInfo.time as Record<string, unknown>).completed !== undefined))
    if (
      event.type === "session.compacted"
      || event.type === "session.compaction.ended"
      || event.type === "session.compaction.failed"
      || messageUpdatedEnded
    ) {
      const props = event.properties as Record<string, unknown> | undefined
      const sessionID = resolveSessionEventID(props)
      const compaction = sessionID ? getCompaction(sessionID) : undefined
      const endedAt = compaction?.endedAt
      if (sessionID && deps.sessionAwaitingFallbackResult.has(sessionID) && endedAt !== undefined
        && lastEndedRearm.get(sessionID) !== endedAt) {
        lastEndedRearm.set(sessionID, endedAt)
        helpers.scheduleSessionFallbackTimeout(sessionID)
      }
    }

    if (config.enabled) {
      observeEventForWatchdog(event, firstPromptWatchdog)
    }

    if (event.type === "message.part.updated" || event.type === "message.part.delta") {
      const props = event.properties as Record<string, unknown> | undefined
      const sessionID = resolveSessionEventID(props) ?? resolveSessionEventID(
        typeof props?.part === "object" && props.part !== null
          ? props.part as Record<string, unknown>
          : undefined,
      )
      if (sessionID && deps.sessionAwaitingFallbackResult.has(sessionID)) {
        const lastRearm = lastFallbackProgressRearm.get(sessionID) ?? -Infinity
        if (Date.now() - lastRearm >= 5_000) {
          lastFallbackProgressRearm.set(sessionID, Date.now())
          const compaction = getCompaction(sessionID)
          const timeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
          const delayOverride = compaction && !compaction.endedAt
            ? Math.max(0, Math.min(timeoutMs, COMPACTION_WATCHDOG_BUDGET_MS - (Date.now() - compaction.startedAt)))
            : undefined
          helpers.scheduleSessionFallbackTimeout(sessionID, undefined, delayOverride)
          log(`[runtime-fallback] watchdog-part-progress-rearm`, { sessionID })
        }
      }
    }

    if (event.type === "session.deleted") {
      const props = event.properties as Record<string, unknown> | undefined
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        lastFallbackProgressRearm.delete(sessionID)
        lastEndedRearm.delete(sessionID)
      }
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
        settleRuntimeFallbackRecoveryClaim(input.event, ownsRecovery(sessionID) ? "retry-owned" : "declined")
      }
    }
  }

  const dispose = () => {
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
    deps.fallbackExhaustionToastStates?.clear()
    lastFallbackProgressRearm.clear()
    lastEndedRearm.clear()
    // clearAllCompactions is process-wide by design; retain this cleanup until registry ownership is per hook.
    clearAllCompactions()
  }

  return {
    event: eventHandler,
    "chat.message": chatMessageHandler,
    dispose,
  } as RuntimeFallbackHook
}
