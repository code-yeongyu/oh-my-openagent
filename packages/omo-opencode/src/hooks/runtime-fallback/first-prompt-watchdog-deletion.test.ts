import { describe, expect, it } from "bun:test"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  createHelpers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
  type RecordedCalls,
} from "./first-prompt-watchdog-test-helpers"

function createCalls(): RecordedCalls {
  return { abort: [], autoRetry: [] }
}

describe("first-prompt watchdog deletion cleanup", () => {
  it("#given a session has an armed watchdog #when the session is deleted #then its stale timer cannot dispatch", async () => {
    const timers = installFakeTimers()
    const sessionID = "session-deleted-while-armed"
    const calls = createCalls()
    const watchdog = createFirstPromptWatchdog(
      createDeps(PLUGIN_CONFIG_WITH_FALLBACK),
      createHelpers(calls, AGENT),
      100,
    )

    try {
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)

      watchdog.onSessionTerminal(sessionID, "session.deleted")
      await timers.advanceBy(200)

      expect(calls.abort).toEqual([])
      expect(calls.autoRetry).toEqual([])
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })

  it("#given a session is suspended for delayed-abort correlation #when the session is deleted #then deferred state cannot resume", async () => {
    const timers = installFakeTimers()
    const sessionID = "session-deleted-while-suspended"
    const calls = createCalls()
    const watchdog = createFirstPromptWatchdog(
      createDeps(PLUGIN_CONFIG_WITH_FALLBACK),
      createHelpers(calls, AGENT),
      10,
    )

    try {
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-1")
      await timers.advanceBy(10)
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-2")
      expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
        kind: "defer-terminal",
        sessionID,
      })

      watchdog.onSessionTerminal(sessionID, "session.deleted")
      const callsAfterDeletion = {
        abort: [...calls.abort],
        autoRetry: [...calls.autoRetry],
      }
      await timers.advanceBy(100)

      expect(watchdog.resolveDeferredTerminal(sessionID, true)).toBeUndefined()
      expect(calls).toEqual(callsAfterDeletion)
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })
})
