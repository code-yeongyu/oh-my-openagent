import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  createHelpers,
  FALLBACK_MODEL,
  type FakeTimers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
  type RecordedCalls,
  SAFE_WAIT_AFTER_FIRE_MS,
  SAFE_WAIT_BEFORE_FIRE_MS,
  WATCHDOG_MS,
} from "./first-prompt-watchdog-test-helpers"

describe("first-prompt-watchdog", () => {
  let fakeTimers: FakeTimers | undefined

  function getFakeTimers(): FakeTimers {
    if (!fakeTimers) {
      throw new Error("Fake timers must be installed before advancing watchdog time")
    }
    return fakeTimers
  }

  beforeEach(() => {
    subagentSessions.clear()
    fakeTimers = installFakeTimers()
  })

  afterEach(() => {
    fakeTimers?.restore()
    fakeTimers = undefined
    subagentSessions.clear()
  })

  it("#given a main session stays silent past the threshold and has a fallback configured #when the watchdog fires #then it aborts the in-flight request and dispatches the fallback model", async () => {
    // given
    const sessionID = "session-silent-main"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)
    expect(calls.autoRetry[0].sessionID).toBe(sessionID)
    expect(calls.autoRetry[0].newModel).toBe(FALLBACK_MODEL)
    expect(calls.autoRetry[0].source).toBe("first-prompt-watchdog")

    watchdog.dispose()
  })

  it("#given the watchdog cannot abort a silent main session #when the abort fails #then it does not dispatch a competing fallback request", async () => {
    const sessionID = "session-main-abort-failed"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers: AutoRetryHelpers = {
      ...createHelpers(calls, AGENT),
      abortSessionRequest: async (abortedSessionID, source) => {
        calls.abort.push({ sessionID: abortedSessionID, source })
        return false
      },
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort.length).toBeGreaterThanOrEqual(2)
    expect(calls.abort.every((call) => call.sessionID === sessionID && call.source === "first-prompt-watchdog")).toBe(true)
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given timeout escalation is disabled for a main session #when the first prompt stays silent #then the main-session watchdog does not arm", async () => {
    const sessionID = "session-main-timeout-disabled"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.config.timeout_seconds = 0
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given an active subagent stays silent past the threshold and has a fallback configured #when the watchdog fires #then it still aborts and dispatches the fallback model", async () => {
    const sessionID = "session-silent-active-subagent"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)
    expect(calls.autoRetry[0]).toMatchObject({
      sessionID,
      newModel: FALLBACK_MODEL,
      source: "first-prompt-watchdog",
    })

    watchdog.dispose()
  })

  it("#given timeout escalation is disabled and an active subagent stays silent #when the watchdog fires #then the historical subagent safety net remains active", async () => {
    const sessionID = "session-subagent-timeout-disabled"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.config.timeout_seconds = 0
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)

    watchdog.dispose()
  })

  it("#given a main session produces assistant text before the threshold #when progress is observed #then the watchdog is cancelled and no fallback is dispatched", async () => {
    // given
    const sessionID = "session-main-makes-progress"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onAssistantProgress(sessionID)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a fallback dispatch is already awaiting its result #when its internal user update is observed #then the first-prompt watchdog does not arm for that retry", async () => {
    const sessionID = "session-internal-fallback-user-update"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.internallyAbortedSessions.add(sessionID)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, FALLBACK_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])
    watchdog.dispose()
  })

  it("#given assistant progress cancels an armed watchdog #when a later user turn stays silent #then the watchdog re-arms for the new turn", async () => {
    const sessionID = "session-main-rearms-after-progress"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onAssistantProgress(sessionID)
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)
    watchdog.dispose()
  })

  it("#given session emits message.part.updated with sessionID under properties.part #when watchdog tracks #then the watchdog recognizes progress and resets the silence timer", async () => {
    // given
    const sessionID = "session-nested-part-progress"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    observeEventForWatchdog(
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-1",
            messageID: "msg-1",
            sessionID,
            type: "text",
            text: "still working",
          },
        },
      },
      watchdog,
    )
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given the user prompt part arrives after the watchdog arms #when the provider stays silent #then the user part does not cancel fallback recovery", async () => {
    const sessionID = "session-user-part-before-silence"
    const userMessageID = "msg-user-silent"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: {
          info: {
            id: userMessageID,
            sessionID,
            role: "user",
            model: PRIMARY_MODEL,
            agent: AGENT,
          },
        },
      },
      watchdog,
    )
    observeEventForWatchdog(
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-user-silent",
            messageID: userMessageID,
            sessionID,
            type: "text",
            text: "Reply exactly QA_FALLBACK_OK",
          },
        },
      },
      watchdog,
    )
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)
    watchdog.dispose()
  })

})
