import { describe, expect, it } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createModelFallbackContinuationController } from "./event-model-fallback-state"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
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

describe("model-fallback continuation generation ownership", () => {
  it("#given an old continuation is paused during abort #when the session ID is cleared and reused #then only the replacement continuation can dispatch and release ownership", async () => {
    const oldAbort = deferred<unknown>()
    const newAbort = deferred<unknown>()
    const oldAbortStarted = deferred<void>()
    const newAbortStarted = deferred<void>()
    const promptModels: string[] = []
    let abortCalls = 0
    const continuationOwners = new Map<string, symbol>()
    const lastDispatchedContinuationKeys = new Map()
    const controller = createModelFallbackContinuationController({
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({
        directory: "/tmp",
        client: {
          session: {
            abort: async () => {
              abortCalls += 1
              if (abortCalls === 1) { oldAbortStarted.resolve(); return oldAbort.promise }
              newAbortStarted.resolve()
              return newAbort.promise
            },
            promptAsync: async (input: unknown) => {
              const model = readPromptModel(input)
              if (model) promptModels.push(model)
              return {}
            },
          },
        },
      }),
      lastKnownModelBySession: new Map(),
      continuationOwners,
      lastDispatchedContinuationKeys,
    })
    const sessionID = "session-model-fallback-reuse"

    const oldContinuation = controller.autoContinueAfterFallback(sessionID, "old", {
      agentName: "sisyphus",
      providerID: "anthropic",
      modelID: "old-model",
    })
    await oldAbortStarted.promise
    continuationOwners.delete(sessionID)
    lastDispatchedContinuationKeys.delete(sessionID)
    const replacementContinuation = controller.autoContinueAfterFallback(sessionID, "new", {
      agentName: "sisyphus",
      providerID: "openai",
      modelID: "new-model",
    })
    await newAbortStarted.promise
    oldAbort.resolve({})
    await oldContinuation

    expect(promptModels).toEqual([])
    expect(continuationOwners.has(sessionID)).toBe(true)

    newAbort.resolve({})
    await replacementContinuation
    expect(promptModels).toEqual(["openai/new-model"])
    expect(continuationOwners.has(sessionID)).toBe(false)
  })
})
