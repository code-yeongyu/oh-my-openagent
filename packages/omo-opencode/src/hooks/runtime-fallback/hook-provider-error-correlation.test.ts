import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { installFakeTimers } from "./first-prompt-watchdog-test-helpers"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-provider-error-correlation"
const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FIRST_FALLBACK = "anthropic/fallback-1"
const SECOND_FALLBACK = "google/fallback-2"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
        status: async () => ({ data: { [SESSION_ID]: { type: "busy" } } }),
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

describe("runtime-fallback provider error during abort correlation", () => {
  it("#given a prior watchdog abort is suspended #when the current request emits a retryable provider error #then the fallback chain advances without resetting", async () => {
    const timers = installFakeTimers()
    let deps: HookDeps | undefined
    const dispatchedModels: string[] = []
    const hook = createRuntimeFallbackHook(createContext(), {
      config: { enabled: true, timeout_seconds: 30 },
      pluginConfig: {
        agents: {
          [AGENT]: {
            model: PRIMARY_MODEL,
            fallback_models: [{ model: FIRST_FALLBACK }, { model: SECOND_FALLBACK }],
          },
        },
      },
    }, {
      createAutoRetryHelpers: (hookDeps: HookDeps): AutoRetryHelpers => {
        deps = hookDeps
        return {
          abortSessionRequest: async () => {
            hookDeps.internallyAbortedSessions.add(SESSION_ID)
            return true
          },
          clearSessionFallbackTimeout: () => {},
          scheduleSessionFallbackTimeout: () => {},
          autoRetryWithFallback: async (_sessionID, model) => {
            dispatchedModels.push(model)
            return { accepted: true, status: "dispatched" }
          },
          resolveAgentForSessionFromContext: async () => AGENT,
          cleanupStaleSessions: () => {},
        }
      },
      createFirstPromptWatchdog: (hookDeps, helpers) => createFirstPromptWatchdog(hookDeps, helpers, 1),
    })

    try {
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: { id: "user-generation-1", role: "user", sessionID: SESSION_ID, agent: AGENT, model: PRIMARY_MODEL },
          },
        },
      })
      await timers.advanceBy(1)
      expect(dispatchedModels).toEqual([FIRST_FALLBACK])

      const state = deps?.sessionStates.get(SESSION_ID)
      if (!state) throw new Error("Expected watchdog fallback state")
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
      deps?.sessionAwaitingFallbackResult.delete(SESSION_ID)
      deps?.internallyAbortedSessions.delete(SESSION_ID)

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: { id: "user-generation-2", role: "user", sessionID: SESSION_ID, agent: AGENT, model: FIRST_FALLBACK },
          },
        },
      })
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError" } },
        },
      })
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "assistant-generation-2",
              parentID: "user-generation-2",
              role: "assistant",
              sessionID: SESSION_ID,
              agent: AGENT,
              model: FIRST_FALLBACK,
              error: { name: "ProviderRateLimitError", statusCode: 429 },
            },
          },
        },
      })

      expect(dispatchedModels).toEqual([FIRST_FALLBACK, SECOND_FALLBACK])
      expect(deps?.sessionStates.get(SESSION_ID)?.currentModel).toBe(SECOND_FALLBACK)
      expect(deps?.sessionStates.get(SESSION_ID)?.attemptCount).toBe(2)
    } finally {
      hook.dispose?.()
      timers.restore()
    }
  })
})
