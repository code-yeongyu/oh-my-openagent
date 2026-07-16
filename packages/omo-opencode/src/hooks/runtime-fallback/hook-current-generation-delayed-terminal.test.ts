import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { installFakeTimers } from "./first-prompt-watchdog-test-helpers"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-current-generation-delayed-terminal"
const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FALLBACK_MODEL = "anthropic/fallback"
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

function userMessage() {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "user-generation-1",
          role: "user",
          sessionID: SESSION_ID,
          agent: AGENT,
          model: PRIMARY_MODEL,
        },
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

function createHarness() {
  let deps: HookDeps | undefined
  const dispatchedModels: string[] = []
  const hook = createRuntimeFallbackHook(createContext(), {
    config: { enabled: true, timeout_seconds: 30, max_fallback_attempts: 3 },
    pluginConfig: {
      agents: {
        [AGENT]: {
          model: PRIMARY_MODEL,
          fallback_models: [{ model: FALLBACK_MODEL }],
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

describe("runtime-fallback current-generation delayed watchdog terminal", () => {
  it("#given fallback dispatch was accepted #when its delayed watchdog abort arrives #then fallback ownership remains intact", async () => {
    const timers = installFakeTimers()
    const harness = createHarness()

    try {
      await harness.hook.event(userMessage())
      await timers.advanceBy(WATCHDOG_MS)
      const deps = harness.getDeps()

      expect(harness.dispatchedModels).toEqual([FALLBACK_MODEL])
      expect(deps.internallyAbortedSessions.has(SESSION_ID)).toBe(false)
      expect(deps.sessionAwaitingFallbackResult.has(SESSION_ID)).toBe(true)

      await harness.hook.event(abortTerminal())

      expect(harness.dispatchedModels).toEqual([FALLBACK_MODEL])
      expect(deps.sessionStates.get(SESSION_ID)?.currentModel).toBe(FALLBACK_MODEL)
      expect(deps.sessionStates.get(SESSION_ID)?.attemptCount).toBe(1)
      expect(deps.sessionAwaitingFallbackResult.has(SESSION_ID)).toBe(true)
    } finally {
      harness.hook.dispose?.()
      timers.restore()
    }
  })

  it("#given the owned delayed watchdog abort was consumed #when another abort arrives #then it remains external cancellation", async () => {
    const timers = installFakeTimers()
    const harness = createHarness()

    try {
      await harness.hook.event(userMessage())
      await timers.advanceBy(WATCHDOG_MS)
      const deps = harness.getDeps()
      await harness.hook.event(abortTerminal())

      await harness.hook.event(abortTerminal())

      expect(harness.dispatchedModels).toEqual([FALLBACK_MODEL])
      expect(deps.sessionStates.get(SESSION_ID)?.currentModel).toBe(PRIMARY_MODEL)
      expect(deps.sessionStates.get(SESSION_ID)?.attemptCount).toBe(0)
      expect(deps.sessionAwaitingFallbackResult.has(SESSION_ID)).toBe(false)
    } finally {
      harness.hook.dispose?.()
      timers.restore()
    }
  })
})
