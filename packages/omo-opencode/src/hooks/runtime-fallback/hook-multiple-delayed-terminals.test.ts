import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { installFakeTimers } from "./first-prompt-watchdog-test-helpers"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-multiple-delayed-terminals"
const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FIRST_FALLBACK = "anthropic/fallback-1"
const SECOND_FALLBACK = "google/fallback-2"
const THIRD_FALLBACK = "openai/fallback-3"
const WATCHDOG_MS = 10

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

function userMessage(id: string, model: string) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: { id, role: "user", sessionID: SESSION_ID, agent: AGENT, model },
      },
    },
  }
}

function abortTerminal() {
  return {
    event: {
      type: "session.error",
      properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError" } },
    },
  }
}

function priorAbortMessage() {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-generation-1",
          parentID: "user-generation-1",
          role: "assistant",
          sessionID: SESSION_ID,
          error: { name: "MessageAbortedError" },
        },
      },
    },
  }
}

describe("runtime-fallback multiple delayed watchdog terminals", () => {
  it("#given two prior watchdog aborts #when both terminals arrive before correlation #then the current watchdog and retry state are preserved", async () => {
    const timers = installFakeTimers()
    let deps: HookDeps | undefined
    let abortCount = 0
    const dispatchedModels: string[] = []
    const hook = createRuntimeFallbackHook(createContext(), {
      config: { enabled: true, timeout_seconds: 30, max_fallback_attempts: 3 },
      pluginConfig: {
        agents: {
          [AGENT]: {
            model: PRIMARY_MODEL,
            fallback_models: [
              { model: FIRST_FALLBACK },
              { model: SECOND_FALLBACK },
              { model: THIRD_FALLBACK },
            ],
          },
        },
      },
    }, {
      createAutoRetryHelpers: (hookDeps: HookDeps): AutoRetryHelpers => {
        deps = hookDeps
        return {
          abortSessionRequest: async () => {
            abortCount += 1
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
      createFirstPromptWatchdog: (hookDeps, helpers) => (
        createFirstPromptWatchdog(hookDeps, helpers, WATCHDOG_MS)
      ),
    })

    const acceptFallback = (): void => {
      const state = deps?.sessionStates.get(SESSION_ID)
      if (!state) throw new Error("Expected watchdog fallback state")
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
      deps?.sessionAwaitingFallbackResult.delete(SESSION_ID)
      deps?.internallyAbortedSessions.delete(SESSION_ID)
    }

    try {
      await hook.event(userMessage("user-generation-1", PRIMARY_MODEL))
      await timers.advanceBy(WATCHDOG_MS)
      acceptFallback()

      await hook.event(userMessage("user-generation-2", FIRST_FALLBACK))
      await timers.advanceBy(WATCHDOG_MS)
      acceptFallback()

      await hook.event(userMessage("user-generation-3", SECOND_FALLBACK))
      await hook.event(abortTerminal())
      await hook.event(abortTerminal())
      await hook.event(priorAbortMessage())
      await timers.advanceBy(WATCHDOG_MS)

      expect(abortCount).toBe(3)
      expect(dispatchedModels).toEqual([FIRST_FALLBACK, SECOND_FALLBACK, THIRD_FALLBACK])
      expect(deps?.sessionStates.get(SESSION_ID)?.attemptCount).toBe(3)
      expect(deps?.sessionStates.get(SESSION_ID)?.currentModel).toBe(THIRD_FALLBACK)
    } finally {
      hook.dispose?.()
      timers.restore()
    }
  })
})
