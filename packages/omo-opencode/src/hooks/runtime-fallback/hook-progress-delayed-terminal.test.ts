import { describe, expect, it } from "bun:test"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { createFallbackState } from "./fallback-state"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-progress-before-delayed-abort"
const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FALLBACK_MODEL = "anthropic/claude-haiku-4-5"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        status: async () => ({ data: { [SESSION_ID]: { type: "busy" } } }),
        promptAsync: async () => ({}),
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

async function flushTasks(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await Promise.resolve()
  }
}

describe("runtime-fallback progress before delayed terminal", () => {
  it("#given generation two has assistant progress #when generation one's delayed abort arrives #then the accepted fallback state is preserved", async () => {
    let deps: HookDeps | undefined
    let dispatchCount = 0
    let notifyFirstDispatch: (() => void) | undefined
    const firstDispatch = new Promise<void>((resolve) => {
      notifyFirstDispatch = resolve
    })
    const hook = createRuntimeFallbackHook(createContext(), {
      config: { enabled: true, timeout_seconds: 30 },
      pluginConfig: {
        agents: {
          [AGENT]: {
            model: PRIMARY_MODEL,
            fallback_models: [{ model: FALLBACK_MODEL }],
          },
        },
      },
    }, {
      createAutoRetryHelpers: (hookDeps) => {
        deps = hookDeps
        return {
          abortSessionRequest: async () => {
            hookDeps.internallyAbortedSessions.add(SESSION_ID)
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
          info: { id: "user-generation-1", role: "user", sessionID: SESSION_ID, agent: AGENT, model: PRIMARY_MODEL },
        },
      },
    })
    await firstDispatch
    await flushTasks()

    const state = deps?.sessionStates.get(SESSION_ID) ?? createFallbackState(PRIMARY_MODEL)
    deps?.sessionStates.set(SESSION_ID, state)
    deps?.sessionAwaitingFallbackResult.delete(SESSION_ID)
    deps?.internallyAbortedSessions.delete(SESSION_ID)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { id: "user-generation-2", role: "user", sessionID: SESSION_ID, agent: AGENT, model: PRIMARY_MODEL },
        },
      },
    })
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { id: "assistant-generation-2", parentID: "user-generation-2", role: "assistant", sessionID: SESSION_ID },
          parts: [{ type: "text", text: "working" }],
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
      event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
    })
    await hook.event({
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
    })

    expect(dispatchCount).toBe(1)
    expect(deps?.sessionStates.get(SESSION_ID)?.currentModel).toBe(FALLBACK_MODEL)
    expect(deps?.sessionStates.get(SESSION_ID)?.attemptCount).toBe(1)
    hook.dispose?.()
  })
})
