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
  it("#given a session has an armed watchdog #when the session is deleted #then its generation bookkeeping is removed", () => {
    const sessionID = "session-deleted-while-armed"
    const generations = new Map<string, number>()
    const watchdog = createFirstPromptWatchdog(
      createDeps(PLUGIN_CONFIG_WITH_FALLBACK),
      createHelpers(createCalls(), AGENT),
      100,
      generations,
    )

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    expect(generations.has(sessionID)).toBe(true)

    watchdog.onSessionTerminal(sessionID, "session.deleted")

    expect(generations.has(sessionID)).toBe(false)
    watchdog.dispose()
  })

  it("#given a session is suspended for delayed-abort correlation #when the session is deleted #then its generation bookkeeping is removed", async () => {
    const timers = installFakeTimers()
    const sessionID = "session-deleted-while-suspended"
    const generations = new Map<string, number>()
    const watchdog = createFirstPromptWatchdog(
      createDeps(PLUGIN_CONFIG_WITH_FALLBACK),
      createHelpers(createCalls(), AGENT),
      10,
      generations,
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

      expect(generations.has(sessionID)).toBe(false)
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })
})
