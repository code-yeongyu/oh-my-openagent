import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  type FakeTimers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
  WATCHDOG_MS,
} from "./first-prompt-watchdog-test-helpers"
import type { AutoRetryHelpers } from "./auto-retry"

function createHelpers(
  calls: { aborts: number; dispatches: number },
  dispatchAccepted: () => boolean = () => true,
): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => { calls.aborts += 1; return true },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {
      calls.dispatches += 1
      return dispatchAccepted()
        ? { accepted: true, status: "dispatched" }
        : { accepted: false, status: "blocked", reason: "test" }
    },
    resolveAgentForSessionFromContext: async () => AGENT,
    cleanupStaleSessions: () => {},
  }
}

describe("first-prompt watchdog ownership races", () => {
  let timers: FakeTimers | undefined

  beforeEach(() => { timers = installFakeTimers() })
  afterEach(() => {
    timers?.restore()
    timers = undefined
  })

  it("re-arms after an accepted abort when fallback dispatch is rejected", async () => {
    const sessionID = "watchdog-dispatch-rejected"
    const calls = { aborts: 0, dispatches: 0 }
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const watchdog = createFirstPromptWatchdog(
      deps,
      createHelpers(calls, () => calls.dispatches > 1),
      WATCHDOG_MS,
    )

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await timers?.advanceBy(WATCHDOG_MS * 3)

    expect(calls).toEqual({ aborts: 2, dispatches: 2 })
    watchdog.dispose()
  })

  it("restores suspended ownership without arming a new timer", async () => {
    const sessionID = "suspended-transfer-rejected"
    const calls = { aborts: 0, dispatches: 0 }
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await timers?.advanceBy(WATCHDOG_MS)
    deps.internallyAbortedSessions.delete(sessionID)
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-2")
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
      kind: "defer-terminal",
      sessionID,
    })
    const transfer = watchdog.onFallbackOwnershipTransferred(sessionID)
    transfer?.rollback()
    await timers?.advanceBy(WATCHDOG_MS * 2)

    expect(calls).toEqual({ aborts: 1, dispatches: 1 })
    expect(watchdog.resolveDeferredTerminal(sessionID, true)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
    watchdog.dispose()
  })

  it("discards inconclusive suspended ownership before a distinct user generation", async () => {
    const sessionID = "unknown-then-new-generation"
    const calls = { aborts: 0, dispatches: 0 }
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await timers?.advanceBy(WATCHDOG_MS)
    deps.internallyAbortedSessions.delete(sessionID)
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-2")
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)?.kind).toBe("defer-terminal")
    expect(watchdog.resolveDeferredTerminal(sessionID, undefined)).toBeUndefined()

    expect(watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-3")).toEqual({
      kind: "discard-terminal",
      sessionID,
    })
    await timers?.advanceBy(WATCHDOG_MS)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    expect(calls).toEqual({ aborts: 2, dispatches: 1 })
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)?.kind).toBe("consume-terminal")
    watchdog.dispose()
  })
})
