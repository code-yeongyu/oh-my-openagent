import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { installFakeTimers } from "./first-prompt-watchdog-test-helpers"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-two-completed-generations"
const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FALLBACK_ONE = "anthropic/fallback-1"
const FALLBACK_TWO = "google/fallback-2"
const WATCHDOG_MS = 10

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({
          data: [
            { info: { role: "user" }, parts: [{ type: "text", text: "question" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "fallback answer" }] },
          ],
        }),
        promptAsync: async () => ({}),
        status: async () => ({ data: { [SESSION_ID]: { type: "busy" } } }),
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

function userMessage(messageID: string, model: string) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: { id: messageID, role: "user", sessionID: SESSION_ID, agent: AGENT, model },
      },
    },
  }
}

function fallbackSuccess(model: string) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: { role: "assistant", sessionID: SESSION_ID, model, completed: true },
      },
    },
  }
}

const sessionIdle = {
  event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
}

const abortTerminal = {
  event: {
    type: "session.error",
    properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError" } },
  },
}

function createHarness() {
  let deps: HookDeps | undefined
  const dispatchedModels: string[] = []
  const hook = createRuntimeFallbackHook(createContext(), {
    config: { enabled: true, timeout_seconds: 30, max_fallback_attempts: 3 },
    pluginConfig: {
      agents: {
        [AGENT]: {
          model: PRIMARY_MODEL,
          fallback_models: [{ model: FALLBACK_ONE }, { model: FALLBACK_TWO }],
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
          hookDeps.sessionAwaitingFallbackResult.add(SESSION_ID)
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

  return {
    hook,
    dispatchedModels,
    getDeps: (): HookDeps => {
      if (!deps) throw new Error("Expected runtime-fallback dependencies")
      return deps
    },
  }
}

describe("runtime-fallback completed watchdog generations", () => {
  it("#given two watchdog fallbacks completed visibly #when newest then oldest delayed aborts arrive #then latest fallback remains until a later real cancellation", async () => {
    const timers = installFakeTimers()
    const harness = createHarness()

    try {
      await harness.hook.event(userMessage("user-generation-1", PRIMARY_MODEL))
      await timers.advanceBy(WATCHDOG_MS)
      await harness.hook.event(fallbackSuccess(FALLBACK_ONE))
      await harness.hook.event(sessionIdle)

      await harness.hook.event(userMessage("user-generation-2", FALLBACK_ONE))
      await timers.advanceBy(WATCHDOG_MS)
      await harness.hook.event(fallbackSuccess(FALLBACK_TWO))
      await harness.hook.event(sessionIdle)

      const deps = harness.getDeps()
      expect(harness.dispatchedModels).toEqual([FALLBACK_ONE, FALLBACK_TWO])
      expect(deps.sessionStates.get(SESSION_ID)?.attemptCount).toBe(2)

      await harness.hook.event(abortTerminal)
      await harness.hook.event(abortTerminal)

      expect(deps.sessionStates.get(SESSION_ID)?.currentModel).toBe(FALLBACK_TWO)
      expect(deps.sessionStates.get(SESSION_ID)?.attemptCount).toBe(2)

      await harness.hook.event(userMessage("user-generation-3", FALLBACK_TWO))
      await harness.hook.event(abortTerminal)

      expect(deps.sessionStates.get(SESSION_ID)?.currentModel).toBe(PRIMARY_MODEL)
      expect(deps.sessionStates.get(SESSION_ID)?.attemptCount).toBe(0)
    } finally {
      harness.hook.dispose?.()
      timers.restore()
    }
  })
})
