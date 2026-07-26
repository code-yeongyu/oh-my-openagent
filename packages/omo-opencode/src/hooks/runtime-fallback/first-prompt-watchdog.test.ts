import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog, observeEventForWatchdog, type FirstPromptWatchdog } from "./first-prompt-watchdog"
import { releaseFallbackDispatchLease, tryAcquireFallbackDispatchLease } from "./fallback-dispatch-lease"

const WATCHDOG_MS = 100
const SAFE_WAIT_BEFORE_FIRE_MS = 40
const SAFE_WAIT_AFTER_FIRE_MS = 250

type FakeTimers = {
  advanceBy: (ms: number) => Promise<void>
  restore: () => void
}

function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalDateNow = Date.now
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void | Promise<void>>()
  const dueTimes = new Map<ReturnType<typeof setTimeout>, number>()
  let now = Date.now()

  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof handler !== "function") {
      throw new Error("String timer handlers are not supported in tests")
    }

    const timer = originalSetTimeout(() => {}, 0)
    originalClearTimeout(timer)
    callbacks.set(timer, () => handler(...args))
    dueTimes.set(timer, now + Math.max(0, delay ?? 0))
    return timer
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>): void => {
    callbacks.delete(timer)
    dueTimes.delete(timer)
  }) as typeof clearTimeout
  Date.now = () => now

  return {
    async advanceBy(ms) {
      const target = now + ms
      while (true) {
        const nextTimer = nextTimerDueBefore(target)
        if (!nextTimer) break
        now = dueTimes.get(nextTimer) ?? now
        const callback = callbacks.get(nextTimer)
        callbacks.delete(nextTimer)
        dueTimes.delete(nextTimer)
        await callback?.()
        await flushMicrotasks()
      }
      now = target
      await flushMicrotasks()
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      Date.now = originalDateNow
    },
  }

  function nextTimerDueBefore(target: number): ReturnType<typeof setTimeout> | undefined {
    return [...dueTimes.entries()]
      .filter(([, dueAt]) => dueAt <= target)
      .sort((left, right) => left[1] - right[1])[0]?.[0]
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(pluginConfig: HookDeps["pluginConfig"] = undefined): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

interface RecordedCalls {
  abort: Array<{ sessionID: string; source: string }>
  autoRetry: Array<{ sessionID: string; newModel: string; resolvedAgent: string | undefined; source: string }>
}

function createHelpers(calls: RecordedCalls, resolvedAgentName?: string): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string, source: string) => {
      calls.abort.push({ sessionID, source })
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID, newModel, resolvedAgent, source) => {
      calls.autoRetry.push({ sessionID, newModel, resolvedAgent, source })
    },
    resolveAgentForSessionFromContext: async () => resolvedAgentName,
    cleanupStaleSessions: () => {},
  }
}

const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FALLBACK_MODEL = "anthropic/claude-haiku-4-5"
const PLUGIN_CONFIG_WITH_FALLBACK = {
  git_master: {
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  },
  agents: {
    [AGENT]: {
      model: PRIMARY_MODEL,
      fallback_models: [{ model: FALLBACK_MODEL }],
    },
  },
}

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

  it("#given a subagent stays silent past the threshold and has a fallback configured #when the watchdog fires #then it aborts the in-flight request and dispatches the fallback model", async () => {
    // given
    const sessionID = "session-silent-subagent"
    subagentSessions.add(sessionID)
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

  it("#given a subagent produces assistant text before the threshold #when progress is observed #then the watchdog is cancelled and no fallback is dispatched", async () => {
    // given
    const sessionID = "session-makes-progress"
    subagentSessions.add(sessionID)
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

  it("#given session emits message.part.delta with field/delta but no part.type #when watchdog tracks #then the watchdog recognizes progress", async () => {
    // given
    const sessionID = "session-delta-progress"
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
        type: "message.part.delta",
        properties: { sessionID, field: "text", delta: "x" },
      },
      watchdog,
    )
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given the session is not a subagent #when a user message is observed #then the watchdog never arms and nothing fires", async () => {
    // given
    const sessionID = "session-not-a-subagent"
    // NOT added to subagentSessions
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a fallback is already awaiting its result #when its internal user prompt is observed #then the watchdog does not arm or abort the fallback", async () => {
    // given
    const sessionID = "session-awaiting-fallback"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a watchdog was armed before fallback dispatch begins #when its timer fires while awaiting fallback #then it does not abort or dispatch a second fallback", async () => {
    // given
    const sessionID = "session-watchdog-race"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given another fallback takes ownership while the watchdog abort is pending #when the abort resolves #then the watchdog does not dispatch a second retry", async () => {
    // given
    const sessionID = "session-watchdog-interleaved-ownership"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    let releaseAbort: (() => void) | undefined
    let markAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => { markAbortStarted = resolve })
    const helpers = createHelpers(calls, AGENT)
    helpers.abortSessionRequest = async (id, source) => {
      calls.abort.push({ sessionID: id, source })
      markAbortStarted?.()
      await new Promise<void>((resolve) => { releaseAbort = resolve })
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    const fire = getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)
    await abortStarted
    deps.sessionAwaitingFallbackResult.add(sessionID)
    releaseAbort?.()
    await fire

    // then
    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given the watchdog fires #when the session terminates while agent context resolution is pending #then the stale watchdog generation does not abort or dispatch", async () => {
    // given
    const sessionID = "session-watchdog-terminal-during-resolution"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    let releaseResolution: (() => void) | undefined
    let markResolutionStarted: (() => void) | undefined
    const resolutionStarted = new Promise<void>((resolve) => { markResolutionStarted = resolve })
    const helpers = createHelpers(calls, AGENT)
    helpers.resolveAgentForSessionFromContext = async () => {
      markResolutionStarted?.()
      await new Promise<void>((resolve) => { releaseResolution = resolve })
      return AGENT
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    const fire = getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)
    await resolutionStarted
    watchdog.onSessionTerminal(sessionID)
    releaseResolution?.()
    await fire

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given the watchdog fires #when it is disposed while agent context resolution is pending #then the stale watchdog generation does not abort or dispatch", async () => {
    // given
    const sessionID = "session-watchdog-dispose-during-resolution"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    let releaseResolution: (() => void) | undefined
    let markResolutionStarted: (() => void) | undefined
    const resolutionStarted = new Promise<void>((resolve) => { markResolutionStarted = resolve })
    const helpers = createHelpers(calls, AGENT)
    helpers.resolveAgentForSessionFromContext = async () => {
      markResolutionStarted?.()
      await new Promise<void>((resolve) => { releaseResolution = resolve })
      return AGENT
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    const fire = getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)
    await resolutionStarted
    watchdog.dispose()
    releaseResolution?.()
    await fire

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])
  })

  it("#given the watchdog abort produces session.error followed by session.idle #when the internal-abort marker is consumed before idle #then the watchdog keeps its generation and dispatches the fallback", async () => {
    // given
    const sessionID = "session-watchdog-internal-abort-terminal"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)
    helpers.abortSessionRequest = async (id, source) => {
      calls.abort.push({ sessionID: id, source })
      deps.internallyAbortedSessions.add(id)
      watchdog.onSessionTerminal(id, "session.error")
      deps.internallyAbortedSessions.delete(id)
      watchdog.onSessionTerminal(id, "session.idle")
    }

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)

    watchdog.dispose()
  })

  it("#given the watchdog fallback is dispatching #when the accepted fallback emits a real error #then the watchdog releases its lease for the normal error handler to advance the chain", async () => {
    // given
    const sessionID = "session-watchdog-fallback-real-error"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    let releaseFallbackDispatch: (() => void) | undefined
    let markFallbackDispatchStarted: (() => void) | undefined
    const fallbackDispatchStarted = new Promise<void>((resolve) => { markFallbackDispatchStarted = resolve })
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)
    helpers.abortSessionRequest = async (id, source) => {
      calls.abort.push({ sessionID: id, source })
      deps.internallyAbortedSessions.add(id)
      watchdog.onSessionTerminal(id, "session.error")
      deps.internallyAbortedSessions.delete(id)
      watchdog.onSessionTerminal(id, "session.idle")
    }
    helpers.autoRetryWithFallback = async (id, newModel, resolvedAgent, source) => {
      calls.autoRetry.push({ sessionID: id, newModel, resolvedAgent, source })
      markFallbackDispatchStarted?.()
      await new Promise<void>((resolve) => { releaseFallbackDispatch = resolve })
    }

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    const fire = getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)
    await fallbackDispatchStarted
    watchdog.onSessionTerminal(sessionID, "session.error")
    const nextLease = tryAcquireFallbackDispatchLease(deps, sessionID)
    releaseFallbackDispatch?.()
    await fire

    // then
    expect(calls.autoRetry).toHaveLength(1)
    expect(nextLease).toBeDefined()
    if (nextLease) {
      releaseFallbackDispatchLease(deps, sessionID, nextLease)
    }

    watchdog.dispose()
  })

  it("#given the watchdog timeout is disabled #when a silent subagent user prompt arrives #then no watchdog timer is armed", async () => {
    // given
    const sessionID = "session-watchdog-disabled"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), 0)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a subagent reaches a terminal session state before the threshold #when onSessionTerminal is called #then the watchdog is cancelled and no fallback is dispatched", async () => {
    // given
    const sessionID = "session-terminated-early"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onSessionTerminal(sessionID)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a subagent silent past the threshold with no fallback configured #when the watchdog fires #then it logs but does not abort or dispatch (lets the existing error-event paths handle it if one arrives later)", async () => {
    // given
    const sessionID = "session-no-fallback"
    subagentSessions.add(sessionID)
    const deps = createDeps()
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await getFakeTimers().advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })
})

interface RecordedWatchdogCalls {
  user: Array<{ sessionID: string; model?: string; agent?: string }>
  progress: string[]
  terminal: string[]
}

function createRecordingWatchdog(calls: RecordedWatchdogCalls): FirstPromptWatchdog {
  return {
    onUserMessage(sessionID, model, agent) {
      calls.user.push({ sessionID, model, agent })
    },
    onAssistantProgress(sessionID) {
      calls.progress.push(sessionID)
    },
    onSessionTerminal(sessionID) {
      calls.terminal.push(sessionID)
    },
    dispose() {},
  }
}

describe("observeEventForWatchdog", () => {
  const sessionID = "session-observed"

  function freshCalls(): RecordedWatchdogCalls {
    return { user: [], progress: [], terminal: [] }
  }

  it("#given a message.updated event with role=user #when observed #then onUserMessage is called with sessionID/model/agent", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "user", model: "openai/gpt-5.4-mini", agent: "sisyphus-junior" } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([{ sessionID, model: "openai/gpt-5.4-mini", agent: "sisyphus-junior" }])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })

  const assistantProgressParts: ReadonlyArray<readonly [string, { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly tool_use_id?: string }]> = [
    ["text", { type: "text", text: "hello" }],
    ["reasoning", { type: "reasoning", text: "thinking..." }],
    ["tool", { type: "tool" }],
    ["tool_use", { type: "tool_use", id: "t1", name: "Read" }],
    ["tool_result", { type: "tool_result", tool_use_id: "t1" }],
    ["tool-call", { type: "tool-call" }],
    ["step-start", { type: "step-start" }],
    ["file", { type: "file" }],
  ]

  it.each(assistantProgressParts)("#given a message.updated assistant event whose only part is type=%s #when observed #then onAssistantProgress is called (model is *working*, not silent)", (_label: string, part: { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly tool_use_id?: string }) => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant" }, parts: [part] },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  it.each(assistantProgressParts)("#given a message.part.updated event whose part is type=%s #when observed #then onAssistantProgress is called", (_label: string, part: { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly tool_use_id?: string }) => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.part.updated",
        properties: { sessionID, part },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  it("#given a message.updated assistant event with parts: [] and no error/finish #when observed #then no progress is signalled (no activity yet)", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant" }, parts: [] },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([])
  })

  it("#given a message.updated assistant event with info.error set #when observed #then onAssistantProgress is called (the existing error-handling path takes over from here)", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", error: { name: "RateLimitError", message: "429" } } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  it("#given a message.updated assistant event with info.finish set #when observed #then onAssistantProgress is called", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", finish: "stop" } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  const terminalEventTypes: ReadonlyArray<readonly [string]> = [["session.idle"], ["session.stop"], ["session.deleted"], ["session.error"]]

  it.each(terminalEventTypes)(
    "#given a %s event #when observed #then onSessionTerminal is called",
    (eventType: string) => {
      const calls = freshCalls()
      observeEventForWatchdog(
        { type: eventType, properties: { sessionID } },
        createRecordingWatchdog(calls),
      )
      expect(calls.terminal).toEqual([sessionID])
    },
  )

  it("#given a session.deleted event whose sessionID is carried under properties.info.id #when observed #then onSessionTerminal is still called (matches event-handler shape)", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      { type: "session.deleted", properties: { info: { id: sessionID } } },
      createRecordingWatchdog(calls),
    )
    expect(calls.terminal).toEqual([sessionID])
  })

  it("#given an unrelated event type #when observed #then no watchdog method is called", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      { type: "session.created", properties: { info: { id: sessionID } } },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })
})
