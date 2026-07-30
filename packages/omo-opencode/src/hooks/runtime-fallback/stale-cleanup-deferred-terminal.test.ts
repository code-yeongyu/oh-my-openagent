import { describe, expect, it } from "bun:test"
import { createAutoRetryHelpers } from "./auto-retry"
import type { FirstPromptWatchdog } from "./first-prompt-watchdog"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-stale-deferred-terminal"

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

function createWatchdog(): FirstPromptWatchdog {
  return {
    onUserMessage: () => undefined,
    onFallbackOwnershipTransferred: () => undefined,
    onAssistantProgress: () => undefined,
    onFallbackCompleted: () => undefined,
    onSessionTerminal: (sessionID, eventType) => {
      if (eventType === "session.error") return { kind: "defer-terminal", sessionID }
      if (eventType === "session.idle") return { kind: "resolve-terminal", sessionID }
      return undefined
    },
    resolveDeferredTerminal: () => undefined,
    dispose: () => undefined,
  }
}

describe("runtime-fallback stale deferred terminal cleanup", () => {
  it("#given an abort event is deferred #when stale cleanup evicts the session #then later resolution cannot replay the retained payload", async () => {
    const handledEvents: string[] = []
    let capturedDeps: HookDeps | undefined
    let cleanupStaleSessions: (() => void) | undefined
    const hook = createRuntimeFallbackHook(
      createContext(),
      { config: { enabled: true, timeout_seconds: 30 } },
      {
        createAutoRetryHelpers: (deps) => {
          capturedDeps = deps
          const helpers = createAutoRetryHelpers(deps)
          cleanupStaleSessions = helpers.cleanupStaleSessions
          return helpers
        },
        createFirstPromptWatchdog: () => createWatchdog(),
        createEventHandler: () => async ({ event }) => {
          handledEvents.push(event.type)
        },
      },
    )

    try {
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: SESSION_ID, error: { name: "AbortError" } },
        },
      })
      capturedDeps?.sessionLastAccess.set(SESSION_ID, Date.now() - 31 * 60 * 1000)
      cleanupStaleSessions?.()
      await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

      expect(handledEvents).toEqual(["session.idle"])
    } finally {
      hook.dispose?.()
    }
  })
})
