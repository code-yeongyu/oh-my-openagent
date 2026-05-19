import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog, observeEventForWatchdog, type FirstPromptWatchdog } from "./first-prompt-watchdog"

// Real timers are unavoidable here (bun:test has no built-in fake-timer API),
// so margins are sized generously to survive a loaded CI runner. Specifically:
//   - SAFE_WAIT_BEFORE_FIRE_MS must be << WATCHDOG_MS so the cancel call lands
//     before the timer fires even with significant scheduler delay
//     (margin: WATCHDOG_MS - SAFE_WAIT_BEFORE_FIRE_MS >= 60ms here).
//   - SAFE_WAIT_AFTER_FIRE_MS must be >> WATCHDOG_MS so we conclusively
//     observe whether the timer fired (margin: ~2.5x WATCHDOG_MS).
const WATCHDOG_MS = 100
const SAFE_WAIT_BEFORE_FIRE_MS = 40
const SAFE_WAIT_AFTER_FIRE_MS = 250

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  beforeEach(() => {
    subagentSessions.clear()
  })

  afterEach(() => {
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
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

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
    await wait(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onAssistantProgress(sessionID)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

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
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

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
    await wait(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onSessionTerminal(sessionID)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

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
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

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
