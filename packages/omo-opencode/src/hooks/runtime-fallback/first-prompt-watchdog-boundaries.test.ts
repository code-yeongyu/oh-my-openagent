import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  createHelpers,
  type FakeTimers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
  type RecordedCalls,
  SAFE_WAIT_AFTER_FIRE_MS,
  SAFE_WAIT_BEFORE_FIRE_MS,
  WATCHDOG_MS,
} from "./first-prompt-watchdog-test-helpers"

describe("first-prompt watchdog boundaries", () => {
  let fakeTimers: FakeTimers | undefined

  beforeEach(() => {
    subagentSessions.clear()
    fakeTimers = installFakeTimers()
  })

  afterEach(() => {
    fakeTimers?.restore()
    fakeTimers = undefined
    subagentSessions.clear()
  })

  function getFakeTimers(): FakeTimers {
    if (!fakeTimers) throw new Error("Fake timers must be installed before advancing watchdog time")
    return fakeTimers
  }

  it("#given session emits message.part.delta with field/delta but no part.type #when watchdog tracks #then the watchdog recognizes progress", async () => {
    const sessionID = "session-delta-progress"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    observeEventForWatchdog(
      {
        type: "message.part.delta",
        properties: { sessionID, field: "text", delta: "x" },
      },
      watchdog,
    )
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])
    watchdog.dispose()
  })

  it("#given a subagent leaves subagentSessions before the threshold #when the watchdog fires #then it is suppressed", async () => {
    const sessionID = "session-removed-subagent"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    subagentSessions.delete(sessionID)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])
    watchdog.dispose()
  })

  it("#given a subagent reaches a terminal session state before the threshold #when onSessionTerminal is called #then the watchdog is cancelled and no fallback is dispatched", async () => {
    const sessionID = "session-terminated-early"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onSessionTerminal(sessionID)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])
    watchdog.dispose()
  })

  it("#given a main session is silent past the threshold with no fallback configured #when the watchdog fires #then it does not abort or dispatch", async () => {
    const sessionID = "session-main-no-fallback"
    const deps = createDeps()
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])
    watchdog.dispose()
  })
})
