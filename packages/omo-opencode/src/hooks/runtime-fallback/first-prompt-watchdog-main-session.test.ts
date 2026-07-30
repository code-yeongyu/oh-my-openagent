import { afterEach, describe, expect, it } from "bun:test"
import { setMainSession, subagentSessions } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  createHelpers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
  type RecordedCalls,
  SAFE_WAIT_AFTER_FIRE_MS,
  WATCHDOG_MS,
} from "./first-prompt-watchdog-test-helpers"

describe("first-prompt watchdog main-session identity", () => {
  afterEach(() => {
    setMainSession(undefined)
    subagentSessions.clear()
  })

  it("#given two active root sessions #when the older root stays silent #then it still receives watchdog fallback", async () => {
    const timers = installFakeTimers()
    const olderRootSessionID = "session-root-a"
    const newerRootSessionID = "session-root-b"
    setMainSession(olderRootSessionID)
    setMainSession(newerRootSessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(
      deps,
      createHelpers(calls, AGENT),
      WATCHDOG_MS,
    )

    try {
      watchdog.onUserMessage(olderRootSessionID, PRIMARY_MODEL, AGENT)
      await timers.advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

      expect(calls.abort).toEqual([
        { sessionID: olderRootSessionID, source: "first-prompt-watchdog" },
      ])
      expect(calls.autoRetry).toEqual([
        {
          sessionID: olderRootSessionID,
          newModel: "anthropic/claude-haiku-4-5",
          resolvedAgent: AGENT,
          source: "first-prompt-watchdog",
        },
      ])
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })

  it("#given an authoritative main session exists #when an unregistered parent-linked child stays silent #then the main-session watchdog does not claim it", async () => {
    const timers = installFakeTimers()
    const mainSessionID = "session-main"
    const childSessionID = "session-parent-linked-child"
    setMainSession(mainSessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(
      deps,
      createHelpers(calls, AGENT),
      WATCHDOG_MS,
    )

    try {
      watchdog.onUserMessage(childSessionID, PRIMARY_MODEL, AGENT)
      await timers.advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

      expect(calls.abort).toEqual([])
      expect(calls.autoRetry).toEqual([])
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })
})
