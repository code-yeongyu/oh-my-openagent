import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { createFallbackState } from "./fallback-state"
import { createRuntimeFallbackHook } from "./hook"
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

function createHelpers(): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => true,
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

function createStatusContext(status: "busy" | "idle"): RuntimeFallbackPluginInput {
  const context = {
    ...createContext(),
    client: {
      ...createContext().client,
      session: {
        ...createContext().client.session,
        status: async () => ({ data: { "session-cross-generation": { type: status } } }),
      },
    },
  }
  return context
}

async function flushTasks(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await Promise.resolve()
  }
}

describe("runtime-fallback deferred watchdog terminal events", () => {
  it("#given an ambiguous watchdog abort #when assistant parent correlation resolves it #then the deferred terminal event is handled before the message update", async () => {
    const sessionID = "session-deferred-watchdog-abort"
    const calls: string[] = []
    const hook = createRuntimeFallbackHook(createContext(), {
      config: { enabled: true },
      pluginConfig: {},
    }, {
      createAutoRetryHelpers: (_deps: HookDeps) => createHelpers(),
      createEventHandler: () => async () => {
        calls.push("terminal")
      },
      createMessageUpdateHandler: () => async () => {
        calls.push("message")
      },
      createFirstPromptWatchdog: () => ({
        onUserMessage: () => {},
        onAssistantProgress: () => ({ kind: "resolve-terminal", sessionID }),
        onSessionTerminal: () => ({ kind: "defer-terminal", sessionID }),
        resolveDeferredTerminal: () => ({ kind: "resolve-terminal", sessionID }),
        dispose: () => {},
      }),
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    expect(calls).toEqual([])

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-2",
            parentID: "user-2",
            role: "assistant",
            sessionID,
            error: { name: "MessageAbortedError" },
          },
        },
      },
    })

    expect(calls).toEqual(["terminal", "message"])
    hook.dispose?.()
  })

  it("#given an old-parent terminal candidate #when the newer request is busy #then the deferred event resolves as internal before the message update", async () => {
    const sessionID = "session-cross-generation"
    const calls: string[] = []
    let inspectedActive: boolean | undefined
    const hook = createRuntimeFallbackHook(createStatusContext("busy"), {
      config: { enabled: true },
      pluginConfig: {},
    }, {
      createAutoRetryHelpers: () => createHelpers(),
      createEventHandler: () => async () => {
        calls.push("terminal")
      },
      createMessageUpdateHandler: () => async () => {
        calls.push("message")
      },
      createFirstPromptWatchdog: () => ({
        onUserMessage: () => {},
        onAssistantProgress: () => ({ kind: "inspect-terminal", sessionID }),
        onSessionTerminal: () => ({ kind: "defer-terminal", sessionID }),
        resolveDeferredTerminal: (_resolvedSessionID, currentRequestActive) => {
          inspectedActive = currentRequestActive
          return { kind: "resolve-terminal", sessionID }
        },
        dispose: () => {},
      }),
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "assistant", sessionID, error: { name: "MessageAbortedError" } },
        },
      },
    })

    expect(inspectedActive).toBe(true)
    expect(calls).toEqual(["terminal", "message"])
    hook.dispose?.()
  })

  it("#given a current cancellation is deferred #when an old assistant abort arrives while the session is idle #then cancellation resets retry state", async () => {
    const sessionID = "session-cross-generation"
    let deps: HookDeps | undefined
    let dispatchCount = 0
    let notifyFirstDispatch: (() => void) | undefined
    const firstDispatch = new Promise<void>((resolve) => {
      notifyFirstDispatch = resolve
    })
    const hook = createRuntimeFallbackHook(createStatusContext("idle"), {
      config: { enabled: true, timeout_seconds: 30 },
      pluginConfig: {
        agents: {
          [AGENT]: {
            model: PRIMARY_MODEL,
            fallback_models: [{ model: "anthropic/claude-haiku-4-5" }],
          },
        },
      },
    }, {
      createAutoRetryHelpers: (hookDeps: HookDeps) => {
        deps = hookDeps
        return {
          abortSessionRequest: async () => {
            hookDeps.internallyAbortedSessions.add(sessionID)
            return true
          },
          clearSessionFallbackTimeout: () => {},
          scheduleSessionFallbackTimeout: () => {},
          autoRetryWithFallback: async () => {
            dispatchCount += 1
            notifyFirstDispatch?.()
            return { accepted: true, status: "dispatched" }
          },
          resolveAgentForSessionFromContext: async () => AGENT,
          cleanupStaleSessions: () => {},
        }
      },
      createFirstPromptWatchdog: (hookDeps, helpers) => createFirstPromptWatchdog(hookDeps, helpers, 1),
    })

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { id: "user-generation-1", role: "user", sessionID, agent: AGENT, model: PRIMARY_MODEL },
        },
      },
    })
    await firstDispatch
    await flushTasks()

    const state = deps?.sessionStates.get(sessionID) ?? createFallbackState(PRIMARY_MODEL)
    deps?.sessionStates.set(sessionID, state)
    deps?.sessionAwaitingFallbackResult.delete(sessionID)
    deps?.internallyAbortedSessions.delete(sessionID)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { id: "user-generation-2", role: "user", sessionID, agent: AGENT, model: PRIMARY_MODEL },
        },
      },
    })
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-generation-1",
            parentID: "user-generation-1",
            role: "assistant",
            sessionID,
            error: { name: "MessageAbortedError" },
          },
        },
      },
    })

    expect(dispatchCount).toBe(1)
    expect(deps?.sessionStates.get(sessionID)?.currentModel).toBe(PRIMARY_MODEL)
    expect(deps?.sessionStates.get(sessionID)?.attemptCount).toBe(0)
    hook.dispose?.()
  })
})
