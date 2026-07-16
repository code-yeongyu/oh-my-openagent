import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

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
})
