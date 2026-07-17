import { describe, expect, it } from "bun:test"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

describe("runtime fallback status ambiguity", () => {
  it("retains deferred terminal ownership when session.status is inconclusive", async () => {
    const sessionID = "status-probe-error"
    let inspected: boolean | undefined | "not-called" = "not-called"
    const ctx: RuntimeFallbackPluginInput = {
      client: {
        session: {
          abort: async () => ({}),
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
          status: async () => { throw new Error("transport unavailable") },
        },
        tui: { showToast: async () => ({}) },
      },
      directory: "/test/dir",
    }
    const hook = createRuntimeFallbackHook(ctx, { config: { enabled: true } }, {
      createEventHandler: () => async () => {},
      createMessageUpdateHandler: () => async () => {},
      createFirstPromptWatchdog: () => ({
        onUserMessage: () => {},
        onFallbackOwnershipTransferred: () => undefined,
        onAssistantProgress: () => ({ kind: "inspect-terminal", sessionID }),
        onFallbackCompleted: () => {},
        onSessionTerminal: () => ({ kind: "defer-terminal", sessionID }),
        resolveDeferredTerminal: (_id, active) => { inspected = active },
        dispose: () => {},
      }),
      createAutoRetryHelpers: (_deps: HookDeps) => ({
        abortSessionRequest: async () => true,
        clearSessionFallbackTimeout: () => {},
        scheduleSessionFallbackTimeout: () => {},
        autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
        resolveAgentForSessionFromContext: async () => undefined,
        cleanupStaleSessions: () => {},
      }),
    })

    await hook.event({
      event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } },
    })
    await hook.event({
      event: {
        type: "message.updated",
        properties: { info: { role: "assistant", sessionID, error: { name: "MessageAbortedError" } } },
      },
    })

    expect(inspected).toBe(undefined)
    hook.dispose?.()
  })
})
