import { afterEach, describe, expect, it } from "bun:test"
import { setMainSession } from "../../features/claude-code-session-state"
import { createAutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { installFakeTimers } from "./first-prompt-watchdog-test-helpers"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-stale-cleanup-reuse"

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: Error) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((reason: Error) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (reason) => rejectPromise?.(reason),
  }
}

function readPromptModel(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("body" in input)) return undefined
  const body = input.body
  if (typeof body !== "object" || body === null || !("model" in body)) return undefined
  const model = body.model
  if (typeof model !== "object" || model === null) return undefined
  const providerID = "providerID" in model ? model.providerID : undefined
  const modelID = "modelID" in model ? model.modelID : undefined
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : undefined
}

function createContext(abort: () => Promise<unknown>, promptModels: string[]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort,
        messages: async () => ({
          data: [{ info: { role: "user" }, parts: [{ type: "text", text: "retry" }] }],
        }),
        promptAsync: async (input: unknown) => {
          const model = readPromptModel(input)
          if (model) promptModels.push(model)
          return {}
        },
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

function userEvent(messageID: string) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: messageID,
          role: "user",
          sessionID: SESSION_ID,
          agent: "sisyphus",
          model: "openai/primary",
        },
      },
    },
  }
}

function retryEvent() {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        agent: "sisyphus",
        model: "openai/primary",
        status: { type: "retry", attempt: 1, message: "Provider unavailable, retrying in 1s attempt #1" },
      },
    },
  }
}

async function runReuseRace(outcome: "resolve" | "reject") {
  const timers = installFakeTimers()
  const oldAbort = createDeferred<unknown>()
  const oldAbortStarted = createDeferred<void>()
  const promptModels: string[] = []
  const abortSources: string[] = []
  let abortCalls = 0
  let capturedDeps: HookDeps | undefined
  let cleanupStaleSessions: (() => void) | undefined
  const hook = createRuntimeFallbackHook(
    createContext(async () => {
      abortCalls += 1
      if (abortCalls === 1) {
        oldAbortStarted.resolve()
        return oldAbort.promise
      }
      return {}
    }, promptModels),
    {
      config: { enabled: true, timeout_seconds: 30, notify_on_fallback: false },
      pluginConfig: {
        agents: {
          sisyphus: { model: "openai/primary", fallback_models: [{ model: "openai/fallback" }] },
        },
      },
    },
    {
      createAutoRetryHelpers: (deps) => {
        capturedDeps = deps
        const helpers = createAutoRetryHelpers(deps)
        cleanupStaleSessions = helpers.cleanupStaleSessions
        return {
          ...helpers,
          abortSessionRequest: async (sessionID, source) => {
            abortSources.push(source)
            return helpers.abortSessionRequest(sessionID, source)
          },
        }
      },
      createFirstPromptWatchdog: (deps, helpers) => createFirstPromptWatchdog(deps, helpers, 10),
    },
  )
  setMainSession(SESSION_ID)

  try {
    await hook.event(userEvent("old-user"))
    const pendingRetry = hook.event(retryEvent())
    await oldAbortStarted.promise
    capturedDeps?.sessionLastAccess.set(SESSION_ID, Date.now() - 31 * 60 * 1000)
    cleanupStaleSessions?.()
    await hook.event(userEvent("new-user"))
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-new",
            role: "assistant",
            sessionID: SESSION_ID,
            parts: [{ type: "text", text: "done" }],
          },
        },
      },
    })
    if (outcome === "resolve") oldAbort.resolve({})
    else oldAbort.reject(new Error("late abort rejection"))
    await pendingRetry
    await timers.advanceBy(50)

    return { abortCalls, abortSources, promptModels, hasState: capturedDeps?.sessionStates.has(SESSION_ID) }
  } finally {
    hook.dispose?.()
    timers.restore()
  }
}

afterEach(() => setMainSession(undefined))

describe("runtime-fallback stale cleanup session reuse", () => {
  const expected = {
    abortCalls: 1,
    abortSources: ["session.status.retry-signal"],
    promptModels: [],
    hasState: false,
  }

  it("#given a cleaned session ID is reused #when the old abort resolves #then rollback cannot revive its watchdog", async () => {
    expect(await runReuseRace("resolve")).toEqual(expected)
  })

  it("#given a cleaned session ID is reused #when the old abort rejects #then rollback cannot revive its watchdog", async () => {
    expect(await runReuseRace("reject")).toEqual(expected)
  })
})
