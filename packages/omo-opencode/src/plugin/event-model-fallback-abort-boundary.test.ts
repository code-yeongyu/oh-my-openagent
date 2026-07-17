import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createModelFallbackContinuationController } from "./event-model-fallback-state"

describe("model-fallback abort boundary", () => {
  test("#given the SDK resolves a non-2xx abort #when continuation starts #then throwing semantics are requested and no prompt is injected", async () => {
    const sessionID = "ses_model_fallback_abort_resolved_error"
    let abortCalledWithThrowOnError = false
    const promptCalls: string[] = []
    const continuationsInFlight = new Set<string>()
    const controller = createModelFallbackContinuationController({
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({
        directory: "/tmp",
        client: {
          session: {
            abort: async (input: { throwOnError?: boolean }) => {
              abortCalledWithThrowOnError = input.throwOnError === true
              return {
                data: undefined,
                error: { name: "NotFoundError" },
                response: new Response(null, { status: 404 }),
              }
            },
            promptAsync: async (input: { path: { id: string } }) => {
              promptCalls.push(input.path.id)
              return {}
            },
          },
        },
      }),
      lastKnownModelBySession: new Map(),
      continuationsInFlight,
      lastDispatchedContinuationKeys: new Map(),
    })

    await controller.autoContinueAfterFallback(sessionID, "message.updated", {
      agentName: "sisyphus",
      providerID: "anthropic",
      modelID: "claude-opus-4-7-thinking",
    })

    expect(abortCalledWithThrowOnError).toBe(true)
    expect(promptCalls).toEqual([])
    expect(continuationsInFlight.has(sessionID)).toBe(false)
  })
})
