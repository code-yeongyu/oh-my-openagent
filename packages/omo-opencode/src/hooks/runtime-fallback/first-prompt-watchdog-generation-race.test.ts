import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

function createDeps(): HookDeps {
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
    pluginConfig: {
      agents: {
        [AGENT]: {
          model: PRIMARY_MODEL,
          fallback_models: [
            { model: "anthropic/claude-haiku-4-5" },
            { model: "google/gemini-3-flash" },
          ],
        },
      },
    },
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function createAbortEvent(sessionID: string) {
  return {
    event: {
      type: "session.error",
      properties: { sessionID, error: { name: "MessageAbortedError" } },
    },
  }
}

async function flushTasks(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await Promise.resolve()
  }
}

describe("first-prompt watchdog generation races", () => {
  it("#given the watchdog abort is acknowledged #when a user abort arrives while fallback dispatch is settling #then cancellation wins and the fallback request is stopped", async () => {
    const sessionID = "session-post-ack-user-abort"
    const deps = createDeps()
    deps.sessionStates.set(sessionID, createFallbackState(PRIMARY_MODEL))
    let resolveAbort: ((value: boolean) => void) | undefined
    let notifyAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      notifyAbortStarted = resolve
    })
    const abortResult = new Promise<boolean>((resolve) => {
      resolveAbort = resolve
    })
    let notifyDispatchStarted: (() => void) | undefined
    let releaseDispatch: (() => void) | undefined
    const dispatchStarted = new Promise<void>((resolve) => {
      notifyDispatchStarted = resolve
    })
    const dispatchReleased = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    const calls = { abortSources: [] as string[], dispatch: 0 }
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async (_abortedSessionID, source) => {
        calls.abortSources.push(source)
        if (source === "first-prompt-watchdog") {
          deps.internallyAbortedSessions.add(sessionID)
          notifyAbortStarted?.()
          return abortResult
        }
        return true
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        calls.dispatch += 1
        notifyDispatchStarted?.()
        await dispatchReleased
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)
    const eventHandler = createEventHandler(deps, helpers)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await abortStarted
    resolveAbort?.(true)
    await dispatchStarted
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
      kind: "inspect-terminal",
      sessionID,
    })
    expect(watchdog.resolveDeferredTerminal(sessionID, false)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
    await eventHandler(createAbortEvent(sessionID))
    releaseDispatch?.()
    await flushTasks()

    expect(calls.dispatch).toBe(1)
    expect(calls.abortSources).toEqual(["first-prompt-watchdog", "session.stop"])
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe(PRIMARY_MODEL)
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(0)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    watchdog.dispose()
  })

  it("#given generation one dispatched a fallback #when its delayed abort arrives after generation two arms #then generation two remains owned", async () => {
    const sessionID = "session-delayed-prior-generation-abort"
    const deps = createDeps()
    deps.sessionStates.set(sessionID, createFallbackState(PRIMARY_MODEL))
    const calls = { dispatch: 0 }
    let notifyFirstDispatch: (() => void) | undefined
    let notifySecondDispatch: (() => void) | undefined
    const firstDispatch = new Promise<void>((resolve) => {
      notifyFirstDispatch = resolve
    })
    const secondDispatch = new Promise<void>((resolve) => {
      notifySecondDispatch = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        deps.internallyAbortedSessions.add(sessionID)
        return true
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        calls.dispatch += 1
        if (calls.dispatch === 1) notifyFirstDispatch?.()
        if (calls.dispatch === 2) notifySecondDispatch?.()
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)
    const eventHandler = createEventHandler(deps, helpers)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-1")
    await firstDispatch
    await flushTasks()
    expect(calls.dispatch).toBe(1)

    deps.internallyAbortedSessions.delete(sessionID)
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-2")
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
      kind: "defer-terminal",
      sessionID,
    })
    expect(watchdog.onAssistantProgress(sessionID, "user-generation-1", true)).toEqual({
      kind: "inspect-terminal",
      sessionID,
    })
    expect(watchdog.resolveDeferredTerminal(sessionID, true)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
    await eventHandler(createAbortEvent(sessionID))
    await secondDispatch

    expect(calls.dispatch).toBe(2)
    expect(deps.sessionStates.get(sessionID)?.currentModel).not.toBe(PRIMARY_MODEL)
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBeGreaterThan(0)
    watchdog.dispose()
  })

  it("#given generation one retains abort provenance #when generation two is cancelled before the delayed abort arrives #then cancellation prevents a second fallback", async () => {
    const sessionID = "session-current-cancellation-before-delayed-abort"
    const deps = createDeps()
    deps.sessionStates.set(sessionID, createFallbackState(PRIMARY_MODEL))
    const calls = { dispatch: 0 }
    let notifyFirstDispatch: (() => void) | undefined
    const firstDispatch = new Promise<void>((resolve) => {
      notifyFirstDispatch = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        deps.internallyAbortedSessions.add(sessionID)
        return true
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        calls.dispatch += 1
        notifyFirstDispatch?.()
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)
    const eventHandler = createEventHandler(deps, helpers)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-1")
    await firstDispatch
    await flushTasks()
    expect(calls.dispatch).toBe(1)

    deps.internallyAbortedSessions.delete(sessionID)
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-2")
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
      kind: "defer-terminal",
      sessionID,
    })
    expect(watchdog.onAssistantProgress(sessionID, "user-generation-2", true)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
    await eventHandler(createAbortEvent(sessionID))

    expect(calls.dispatch).toBe(1)
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe(PRIMARY_MODEL)
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(0)
    watchdog.dispose()
  })
})
