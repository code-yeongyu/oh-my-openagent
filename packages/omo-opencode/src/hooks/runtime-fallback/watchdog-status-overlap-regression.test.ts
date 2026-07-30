import { afterEach, describe, expect, it } from "bun:test"

import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { createAbortSessionRequest } from "./auto-retry-abort"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"
import { createSessionStatusHandler } from "./session-status-handler"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
}

function retryStatus(sessionID: string) {
  return {
    sessionID,
    model: PRIMARY_MODEL,
    agent: AGENT,
    status: { type: "retry", attempt: 1, message: "rate limit, retrying in 1 second" },
  }
}

afterEach(() => SessionCategoryRegistry.clear())

describe("runtime-fallback watchdog and status overlap", () => {
  it("#given a replacement retry owner appears during status abort #when the old transaction settles #then the detached watchdog is committed", async () => {
    const timers = installFakeTimers()
    const sessionID = "status-replacement-owner"
    const abortResponse = deferred<boolean>()
    const abortStarted = deferred<void>()
    const abortSources: string[] = []
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.sessionRetryOwners = new Map()
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionRetryOwners.set(sessionID, Symbol("original"))
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async (_sessionID, source) => {
        abortSources.push(source)
        abortStarted.resolve()
        return abortResponse.promise
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 100)
    const handler = createSessionStatusHandler(
      deps,
      helpers,
      (id) => watchdog.onFallbackOwnershipTransferred(id),
    )

    try {
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
      const handling = handler(retryStatus(sessionID))
      await abortStarted.promise
      const replacementOwner = Symbol("replacement")
      deps.sessionRetryOwners.set(sessionID, replacementOwner)
      abortResponse.resolve(true)
      await handling
      await timers.advanceBy(200)

      expect(abortSources).toEqual(["session.status.retry-signal"])
      expect(deps.sessionRetryOwners.get(sessionID)).toBe(replacementOwner)
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })

  it("#given watchdog and status coalesce one abort #when its terminal is consumed #then the next user abort remains external", async () => {
    const timers = installFakeTimers()
    const sessionID = "coalesced-watchdog-status-abort"
    const abortResponse = deferred<unknown>()
    const abortStarted = deferred<void>()
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.ctx.client.session.abort = async () => {
      abortStarted.resolve()
      return abortResponse.promise
    }
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: createAbortSessionRequest(deps),
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)
    const eventHandler = createEventHandler(deps, helpers)
    const statusHandler = createSessionStatusHandler(
      deps,
      helpers,
      (id) => watchdog.onFallbackOwnershipTransferred(id),
    )

    try {
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
      const watchdogCallbacks = timers.startDueBy(1)
      await abortStarted.promise
      const status = statusHandler(retryStatus(sessionID))
      abortResponse.resolve({})
      await Promise.all([...watchdogCallbacks, status])

      expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
        kind: "consume-terminal",
        sessionID,
      })
      const state = createFallbackState(PRIMARY_MODEL)
      state.attemptCount = 1
      deps.sessionStates.set(sessionID, state)
      const decision = watchdog.onSessionTerminal(sessionID, "session.error", true)
      if (decision?.kind !== "consume-terminal") {
        await eventHandler({
          event: {
            type: "session.error",
            properties: { sessionID, error: { name: "MessageAbortedError" } },
          },
        })
      }

      expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(0)
      expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })
})
