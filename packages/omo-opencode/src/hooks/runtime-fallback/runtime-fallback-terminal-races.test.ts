import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  type FakeTimers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"
import type { AutoRetryHelpers } from "./auto-retry"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function retryEvent(sessionID: string) {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID,
        agent: AGENT,
        model: PRIMARY_MODEL,
        status: { type: "retry", attempt: 1, message: "rate limit, retrying in 1 second" },
      },
    },
  }
}

function helpers(overrides: Partial<AutoRetryHelpers> = {}): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => true,
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
    resolveAgentForSessionFromContext: async () => AGENT,
    cleanupStaleSessions: () => {},
    ...overrides,
  }
}

describe("runtime fallback terminal ownership races", () => {
  let timers: FakeTimers | undefined

  beforeEach(() => { timers = installFakeTimers() })
  afterEach(() => {
    timers?.restore()
    timers = undefined
    SessionCategoryRegistry.clear()
  })

  it("does not dispatch after session.stop wins a pending status transaction", async () => {
    const sessionID = "status-stopped-during-resolution"
    const resolution = deferred<string | undefined>()
    const resolutionStarted = deferred<void>()
    let dispatches = 0
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const eventHelpers = helpers({
      resolveAgentForSessionFromContext: async () => {
        resolutionStarted.resolve()
        return resolution.promise
      },
      autoRetryWithFallback: async () => {
        dispatches += 1
        return { accepted: true, status: "dispatched" }
      },
    })
    const handler = createEventHandler(deps, eventHelpers)

    const pending = handler(retryEvent(sessionID))
    await resolutionStarted.promise
    await handler({ event: { type: "session.stop", properties: { sessionID } } })
    await handler({
      event: { type: "message.updated", properties: { info: { role: "user", sessionID } } },
    })
    resolution.resolve(AGENT)
    await pending

    expect(dispatches).toBe(0)
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })

  it("does not re-arm when the same user event is replayed after assistant progress", async () => {
    const sessionID = "same-user-event-replayed"
    let aborts = 0
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const watchdog = createFirstPromptWatchdog(deps, helpers({
      abortSessionRequest: async () => { aborts += 1; return true },
    }), 1)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    watchdog.onAssistantProgress(sessionID, "assistant-parent")
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await timers?.advanceBy(10)

    expect(aborts).toBe(0)
    watchdog.dispose()
  })

  it("re-arms silence protection when watchdog abort is rejected", async () => {
    const sessionID = "watchdog-abort-rejected"
    let aborts = 0
    let dispatches = 0
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const watchdog = createFirstPromptWatchdog(deps, helpers({
      abortSessionRequest: async () => { aborts += 1; return aborts > 1 },
      autoRetryWithFallback: async () => {
        dispatches += 1
        return { accepted: true, status: "dispatched" }
      },
    }), 1)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await timers?.advanceBy(20)

    expect(aborts).toBe(2)
    expect(dispatches).toBe(1)
    watchdog.dispose()
  })

  it("restores watchdog ownership when a status replacement is rejected", async () => {
    const sessionID = "status-replacement-rejected"
    let dispatches = 0
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    SessionCategoryRegistry.register(sessionID, AGENT)
    const eventHelpers = helpers({
      autoRetryWithFallback: async () => {
        dispatches += 1
        return dispatches === 1
          ? { accepted: false, status: "blocked", reason: "test" }
          : { accepted: true, status: "dispatched" }
      },
    })
    const watchdog = createFirstPromptWatchdog(deps, eventHelpers, 1)
    const handler = createEventHandler(
      deps,
      eventHelpers,
      (id) => watchdog.onFallbackOwnershipTransferred(id),
    )

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await handler(retryEvent(sessionID))
    await timers?.advanceBy(10)

    expect(dispatches).toBe(2)
    watchdog.dispose()
  })

  it("restores watchdog ownership when the abort terminal precedes a rejected status replacement", async () => {
    const sessionID = "status-terminal-before-rejected-replacement"
    const abortResponse = deferred<boolean>()
    const abortStarted = deferred<void>()
    let aborts = 0
    let dispatches = 0
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    SessionCategoryRegistry.register(sessionID, AGENT)
    const eventHelpers = helpers({
      abortSessionRequest: async () => {
        aborts += 1
        abortStarted.resolve()
        return abortResponse.promise
      },
      autoRetryWithFallback: async () => {
        dispatches += 1
        return dispatches === 1
          ? { accepted: false, status: "blocked", reason: "test" }
          : { accepted: true, status: "dispatched" }
      },
    })
    const watchdog = createFirstPromptWatchdog(deps, eventHelpers, 1)
    const handler = createEventHandler(
      deps,
      eventHelpers,
      (id) => watchdog.onFallbackOwnershipTransferred(id),
    )

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    const retry = handler(retryEvent(sessionID))
    await abortStarted.promise
    watchdog.onSessionTerminal(sessionID, "session.error", true)
    abortResponse.resolve(true)
    await retry
    await timers?.advanceBy(10)

    expect({ aborts, dispatches }).toEqual({ aborts: 2, dispatches: 2 })
    watchdog.dispose()
  })
})
