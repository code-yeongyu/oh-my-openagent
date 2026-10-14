import { afterEach, describe, expect, test } from "bun:test"
import { createAutoRetryHelpers } from "./auto-retry"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackHook, RuntimeFallbackPluginInput } from "./types"
import {
  clearAllCompactions,
  recordCompactionEnd,
  recordCompactionStart,
} from "../../shared/compaction-in-flight"
import {
  installRuntimeFallbackTestClock,
  restoreRuntimeFallbackTestClock,
} from "./test-timeout-clock.test-support"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

const hookConfig = {
  enabled: true,
  retry_on_errors: [429, 503, 529],
  max_fallback_attempts: 3,
  cooldown_seconds: 0,
  timeout_seconds: 10,
  notify_on_fallback: false,
  restore_primary_after_cooldown: false,
}

function createContext(
  abortCalls: string[],
  toastCalls: string[],
  observers: { onAbort?: () => Promise<void>; onPrompt?: () => void } = {},
): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async ({ path }) => {
          abortCalls.push(path.id)
          await observers.onAbort?.()
          return {}
        },
        messages: async () => ({ data: [] }),
        promptAsync: async () => {
          observers.onPrompt?.()
          return {}
        },
      },
      tui: {
        showToast: async ({ body }) => {
          toastCalls.push(body.message)
          return {}
        },
      },
    },
    directory: "/test/dir",
  }
}

afterEach(() => {
  SessionCategoryRegistry.clear()
  clearAllCompactions()
  restoreRuntimeFallbackTestClock()
})

describe("runtime fallback hook compaction re-arm guards", () => {
  test("#given compaction progress arrives near the watchdog budget #when it re-arms a long timeout #then the budget abort still executes", async () => {
    const abortCalls: string[] = []
    const toastCalls: string[] = []
    let deps: HookDeps | undefined
    const clock = installRuntimeFallbackTestClock(0)
    const hook = createRuntimeFallbackHook(createContext(abortCalls, toastCalls), {
      config: {
        enabled: true,
        retry_on_errors: [429, 503, 529],
        max_fallback_attempts: 3,
        cooldown_seconds: 0,
        timeout_seconds: 10,
        notify_on_fallback: false,
        restore_primary_after_cooldown: false,
      },
      session_timeout_ms: 10_000,
    }, {
      createAutoRetryHelpers: (nextDeps) => {
        deps = nextDeps
        return createAutoRetryHelpers(nextDeps)
      },
    })
    const sessionID = "session-hook-progress-budget"
    await hook.event({ event: { type: "session.created", properties: { info: { id: sessionID, model: "openai/gpt-5.4" } } } })
    deps?.sessionAwaitingFallbackResult.add(sessionID)
    recordCompactionStart(sessionID)

    await clock.advanceBy(599_000)
    await hook.event({ event: { type: "message.part.updated", properties: { sessionID, part: { sessionID, type: "text" } } } })
    await clock.advanceBy(1_000)

    expect(abortCalls).toEqual([sessionID])
    expect(toastCalls).toEqual(["Compaction exceeded its watchdog budget"])
    expect(deps?.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    hook.dispose?.()
  })

  test("#given an ended compaction #when repeated message updates arrive #then post-compaction re-arm runs once per endedAt", async () => {
    const scheduleCalls: Array<{ sessionID: string }> = []
    let deps: HookDeps | undefined
    const hook = createRuntimeFallbackHook(createContext([], []), {}, {
      createAutoRetryHelpers: (nextDeps) => {
        deps = nextDeps
        return {
          abortSessionRequest: async () => {},
          clearSessionFallbackTimeout: () => {},
          scheduleSessionFallbackTimeout: (sessionID: string) => {
            scheduleCalls.push({ sessionID })
          },
          autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" as const }),
          resolveAgentForSessionFromContext: async () => undefined,
          cleanupStaleSessions: () => {},
        }
      },
      createEventHandler: () => async () => {},
      createMessageUpdateHandler: () => async () => {},
      createChatMessageHandler: () => async () => {},
      createFirstPromptWatchdog: () => ({
        onUserMessage: () => {},
        onAssistantProgress: () => {},
        onSessionTerminal: () => {},
        dispose: () => {},
      }),
    })
    const sessionID = "session-hook-ended-rearm"
    deps?.sessionAwaitingFallbackResult.add(sessionID)
    recordCompactionStart(sessionID)
    recordCompactionEnd(sessionID)

    await hook.event({ event: { type: "message.updated", properties: { sessionID, info: { sessionID, role: "assistant", time: { completed: 1 } } } } })
    await hook.event({ event: { type: "message.updated", properties: { sessionID, info: { sessionID, role: "assistant", time: { completed: 1 } } } } })

    expect(scheduleCalls).toEqual([{ sessionID }])
    hook.dispose?.()
  })

  test("#given the budget abort's own errored message.updated and session.idle land before cleanup #when the re-armed window elapses #then no second abort and no fallback dispatch follow", async () => {
    const abortCalls: string[] = []
    const toastCalls: string[] = []
    let promptCalls = 0
    let deps: HookDeps | undefined
    const sessionID = "session-hook-budget-abort-window"
    const compactionMessage = { sessionID, id: "compaction-message", role: "assistant", agent: "compaction" }
    SessionCategoryRegistry.register(sessionID, "test")
    const clock = installRuntimeFallbackTestClock(0)
    const hook: RuntimeFallbackHook = createRuntimeFallbackHook(createContext(abortCalls, toastCalls, {
      onAbort: async () => {
        if (abortCalls.length !== 1) return
        await hook.event({ event: { type: "message.updated", properties: { info: { ...compactionMessage, error: { name: "MessageAbortedError", message: "aborted" } } } } })
        await hook.event({ event: { type: "session.idle", properties: { sessionID } } })
      },
      onPrompt: () => {
        promptCalls += 1
      },
    }), {
      config: hookConfig,
      pluginConfig: { categories: { test: { fallback_models: ["anthropic/claude-sonnet-4-5"] } } },
      session_timeout_ms: 10_000,
    }, {
      createAutoRetryHelpers: (nextDeps) => {
        deps = nextDeps
        return createAutoRetryHelpers(nextDeps)
      },
    })
    await hook.event({ event: { type: "session.created", properties: { info: { id: sessionID, model: "openai/gpt-5.4" } } } })
    deps?.sessionAwaitingFallbackResult.add(sessionID)
    await hook.event({ event: { type: "message.updated", properties: { info: compactionMessage } } })

    await clock.advanceBy(599_000)
    await hook.event({ event: { type: "message.part.updated", properties: { sessionID, part: { sessionID, type: "text" } } } })
    await clock.advanceBy(1_000)

    expect(abortCalls).toEqual([sessionID])
    expect(deps?.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps?.sessionFallbackTimeouts.has(sessionID)).toBe(false)

    await clock.advanceBy(10_000)

    expect(abortCalls).toEqual([sessionID])
    expect(toastCalls).toEqual(["Compaction exceeded its watchdog budget"])
    expect(promptCalls).toBe(0)
    expect(deps?.sessionStates.get(sessionID)?.attemptCount).toBe(0)
    expect(deps?.sessionStates.get(sessionID)?.currentModel).toBe("openai/gpt-5.4")
    hook.dispose?.()
  })

  test("#given stream progress lands while the wedge-return abort is pending #when the re-armed window elapses #then the session is not aborted a second time", async () => {
    const abortCalls: string[] = []
    const toastCalls: string[] = []
    let deps: HookDeps | undefined
    const sessionID = "session-hook-wedge-abort-window"
    const progressEvent = { event: { type: "message.part.updated", properties: { sessionID, part: { sessionID, type: "text" } } } }
    const clock = installRuntimeFallbackTestClock(0)
    const hook: RuntimeFallbackHook = createRuntimeFallbackHook(createContext(abortCalls, toastCalls, {
      onAbort: async () => {
        if (abortCalls.length === 1) await hook.event(progressEvent)
      },
    }), {
      config: hookConfig,
      session_timeout_ms: 10_000,
    }, {
      createAutoRetryHelpers: (nextDeps) => {
        deps = nextDeps
        return createAutoRetryHelpers(nextDeps)
      },
    })
    await hook.event({ event: { type: "session.created", properties: { info: { id: sessionID, model: "openai/gpt-5.4" } } } })
    deps?.sessionAwaitingFallbackResult.add(sessionID)
    await hook.event(progressEvent)

    await clock.advanceBy(10_000)

    expect(abortCalls).toEqual([sessionID])
    expect(deps?.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps?.sessionFallbackTimeouts.has(sessionID)).toBe(false)

    await clock.advanceBy(10_000)

    expect(abortCalls).toEqual([sessionID])
    expect(toastCalls).toEqual(["Runtime fallback could not prepare a replacement"])
    hook.dispose?.()
  })

  test("#given stream progress lands while a refused fallback dispatch is pending #when the re-armed window elapses #then no second abort or fallback dispatch follows", async () => {
    const abortCalls: string[] = []
    const toastCalls: string[] = []
    let promptCalls = 0
    let deps: HookDeps | undefined
    let hook: RuntimeFallbackHook
    const sessionID = "session-hook-refused-dispatch-window"
    SessionCategoryRegistry.register(sessionID, "test")
    const progressEvent = { event: { type: "message.part.updated", properties: { sessionID, part: { sessionID, type: "text" } } } }
    const clock = installRuntimeFallbackTestClock(0)
    hook = createRuntimeFallbackHook({
      client: {
        session: {
          abort: async ({ path }) => {
            abortCalls.push(path.id)
            if (abortCalls.length === 1) await hook.event(progressEvent)
            return {}
          },
          messages: async () => ({ data: [{ info: { id: "user-message", role: "user" }, parts: [{ type: "text", text: "real human prompt" }] }] }),
          promptAsync: async () => {
            promptCalls += 1
            throw new Error("provider rejected prompt")
          },
        },
        tui: {
          showToast: async ({ body }) => {
            toastCalls.push(body.message)
            return {}
          },
        },
      },
      directory: "/test/dir",
    }, {
      config: hookConfig,
      pluginConfig: { categories: { test: { fallback_models: ["anthropic/claude-sonnet-4-5", "google/gemini-2.5-pro"] } } },
      session_timeout_ms: 10_000,
    }, {
      createAutoRetryHelpers: (nextDeps) => {
        deps = nextDeps
        return createAutoRetryHelpers(nextDeps)
      },
    })

    await hook.event({ event: { type: "session.created", properties: { info: { id: sessionID, model: "openai/gpt-5.4" } } } })
    deps?.sessionAwaitingFallbackResult.add(sessionID)
    await hook.event(progressEvent)
    await clock.advanceBy(10_000)

    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toBe(1)
    expect(deps?.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps?.sessionFallbackTimeouts.has(sessionID)).toBe(false)

    await clock.advanceBy(10_000)

    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toBe(1)
    expect(toastCalls).toEqual(["Runtime fallback dispatch was not accepted"])
    hook.dispose?.()
  })
})
