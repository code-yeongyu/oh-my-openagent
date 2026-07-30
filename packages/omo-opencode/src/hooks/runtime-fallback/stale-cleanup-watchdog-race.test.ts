import { afterEach, describe, expect, it } from "bun:test"
import { setMainSession } from "../../features/claude-code-session-state"
import { createAutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { installFakeTimers } from "./first-prompt-watchdog-test-helpers"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-stale-cleanup-watchdog-race"

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: (value) => resolvePromise?.(value) }
}

function readPromptModel(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("body" in input)) return undefined
  const body = input.body
  if (typeof body !== "object" || body === null || !("model" in body)) return undefined
  const model = body.model
  if (typeof model !== "object" || model === null) return undefined
  const providerID = "providerID" in model ? model.providerID : undefined
  const modelID = "modelID" in model ? model.modelID : undefined
  return typeof providerID === "string" && typeof modelID === "string"
    ? `${providerID}/${modelID}`
    : undefined
}

function createContext(abort: () => Promise<unknown>, promptModels: string[]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort,
        messages: async () => ({
          data: [{ info: { role: "user" }, parts: [{ type: "text", text: "retry this" }] }],
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

function retryEvent() {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        agent: "sisyphus",
        model: "openai/primary",
        status: {
          type: "retry",
          attempt: 1,
          message: "Provider unavailable, retrying in 1s attempt #1",
        },
      },
    },
  }
}

afterEach(() => {
  setMainSession(undefined)
})

describe("runtime-fallback stale cleanup watchdog race", () => {
  it("#given cleanup evicts a detached status watchdog #when the stale abort resolves #then rollback cannot restore the watchdog", async () => {
    const timers = installFakeTimers()
    const abortResponse = createDeferred<unknown>()
    const abortStarted = createDeferred<void>()
    const promptModels: string[] = []
    let abortCalls = 0
    let capturedDeps: HookDeps | undefined
    let cleanupStaleSessions: (() => void) | undefined
    const hook = createRuntimeFallbackHook(
      createContext(async () => {
        abortCalls += 1
        if (abortCalls === 1) {
          abortStarted.resolve()
          return abortResponse.promise
        }
        return {}
      }, promptModels),
      {
        config: { enabled: true, timeout_seconds: 30, notify_on_fallback: false },
        pluginConfig: {
          agents: {
            sisyphus: {
              model: "openai/primary",
              fallback_models: [{ model: "openai/fallback-one" }],
            },
          },
        },
      },
      {
        createAutoRetryHelpers: (deps) => {
          capturedDeps = deps
          const helpers = createAutoRetryHelpers(deps)
          cleanupStaleSessions = helpers.cleanupStaleSessions
          return helpers
        },
        createFirstPromptWatchdog: (deps, helpers) => createFirstPromptWatchdog(deps, helpers, 1),
      },
    )
    setMainSession(SESSION_ID)

    try {
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "user-message",
              role: "user",
              sessionID: SESSION_ID,
              agent: "sisyphus",
              model: "openai/primary",
            },
          },
        },
      })
      const pendingRetry = hook.event(retryEvent())
      await abortStarted.promise
      capturedDeps?.sessionLastAccess.set(SESSION_ID, Date.now() - 31 * 60 * 1000)
      cleanupStaleSessions?.()
      abortResponse.resolve({})
      await pendingRetry
      await timers.advanceBy(10)

      expect({ abortCalls, promptModels, hasState: capturedDeps?.sessionStates.has(SESSION_ID) }).toEqual({
        abortCalls: 1,
        promptModels: [],
        hasState: false,
      })
    } finally {
      hook.dispose?.()
      timers.restore()
    }
  })
})
