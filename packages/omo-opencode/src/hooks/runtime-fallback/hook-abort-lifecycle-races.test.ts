import { afterEach, describe, expect, it } from "bun:test"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-hook-abort-lifecycle-race"

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
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

function createHook(abort: () => Promise<unknown>, promptModels: string[]) {
  return createRuntimeFallbackHook(createContext(abort, promptModels), {
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    pluginConfig: {
      categories: {
        test: {
          fallback_models: ["openai/fallback-one", "openai/fallback-two"],
        },
      },
    },
  })
}

function retryEvent(attempt: number) {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        model: "openai/primary",
        status: {
          type: "retry",
          attempt,
          message: `Provider unavailable, retrying in 1s attempt #${attempt}`,
        },
      },
    },
  }
}

afterEach(() => {
  SessionCategoryRegistry.clear()
})

describe("runtime-fallback composed abort lifecycle races", () => {
  it("#given a status abort is rejected #when the same retry arrives again #then the hook retries cancellation and dispatches fallback", async () => {
    const promptModels: string[] = []
    let abortCalls = 0
    const hook = createHook(async () => {
      abortCalls += 1
      return abortCalls === 1 ? { error: { name: "AbortError" } } : {}
    }, promptModels)
    SessionCategoryRegistry.register(SESSION_ID, "test")
    const event = retryEvent(1)

    await hook.event(event)
    await hook.event(event)

    expect(abortCalls).toBe(2)
    expect(promptModels).toEqual(["openai/fallback-one"])
    hook.dispose?.()
  })

  it("#given a status abort event precedes its response #when the next retry arrives #then fallback ownership advances to the second model", async () => {
    const firstAbort = createDeferred<unknown>()
    const abortStarted = createDeferred<void>()
    const promptModels: string[] = []
    let abortCalls = 0
    const hook = createHook(async () => {
      abortCalls += 1
      if (abortCalls === 1) {
        abortStarted.resolve()
        return firstAbort.promise
      }
      return {}
    }, promptModels)
    SessionCategoryRegistry.register(SESSION_ID, "test")

    const firstRetry = hook.event(retryEvent(1))
    await abortStarted.promise
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError" } },
      },
    })
    firstAbort.resolve({})
    await firstRetry
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    await hook.event(retryEvent(2))

    expect(promptModels).toEqual(["openai/fallback-one", "openai/fallback-two"])
    hook.dispose?.()
  })

  it("#given a status abort is pending #when the hook is disposed #then its response cannot dispatch or recreate a timeout", async () => {
    const abortResponse = createDeferred<unknown>()
    const abortStarted = createDeferred<void>()
    const promptModels: string[] = []
    const hook = createHook(async () => {
      abortStarted.resolve()
      return abortResponse.promise
    }, promptModels)
    SessionCategoryRegistry.register(SESSION_ID, "test")

    const retry = hook.event(retryEvent(1))
    await abortStarted.promise
    hook.dispose?.()
    abortResponse.resolve({})
    await retry

    expect(promptModels).toEqual([])
  })
})
