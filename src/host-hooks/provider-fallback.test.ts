import { describe, expect, it } from "bun:test"
import {
  mutateTargetProviderPayload,
  registerTargetProviderFallback,
  type TargetProviderApi,
} from "./provider-fallback"

describe("target provider and fallback hooks", () => {
  it("#given a provider payload with headers #when request mutation runs #then payload shape and headers are preserved", () => {
    const payload = { headers: { authorization: "secret" }, body: { messages: [] } }

    expect(mutateTargetProviderPayload(payload)).toEqual({
      headers: { authorization: "secret", "x-oh-my-openagent": "target-adapter" },
      body: { messages: [] },
    })
  })

  it("#given a retryable provider response #when response observer runs #then an available source fallback model is selected", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const selected: Array<{ provider: string; id: string }> = []
    const api: TargetProviderApi = {
      on: (event, handler) => {
        handlers.set(event, handler)
      },
      setModel: async (model) => {
        selected.push(model)
        return true
      },
    }
    const state = registerTargetProviderFallback(api)

    await handlers.get("after_provider_response")?.(
      { status: 429, headers: {} },
      {
        model: { provider: "test", id: "broken" },
        modelRegistry: {
          find: (provider: string, id: string) =>
            provider === "anthropic" && id === "claude-opus-4-7" ? { provider, id } : undefined,
        },
      },
    )

    expect(selected).toEqual([{ provider: "anthropic", id: "claude-opus-4-7" }])
    expect(state).toMatchObject({ responseErrors: 1, fallbackAttempts: 1, fallbackApplied: 1, lastErrorStatus: 429 })
  })

  it("#given a wrapped provider response #when response observer runs #then status is still observed", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const api: TargetProviderApi = {
      on: (event, handler) => {
        handlers.set(event, handler)
      },
      setModel: async () => true,
    }
    const state = registerTargetProviderFallback(api)

    await handlers.get("after_provider_response")?.(
      { type: "after_provider_response", payload: { status: 429, headers: {} } },
      {
        model: { provider: "test", id: "broken" },
        modelRegistry: {
          find: (provider: string, id: string) => ({ provider, id }),
        },
      },
    )

    expect(state).toMatchObject({ responseErrors: 1, fallbackAttempts: 1, fallbackApplied: 1, lastErrorStatus: 429 })
  })

  it("#given a failed provider turn #when fallback applies #then failed prompt is replayed once", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const replayed: Array<{ content: string; deliverAs?: string }> = []
    const api: TargetProviderApi = {
      on: (event, handler) => {
        handlers.set(event, handler)
      },
      setModel: async () => true,
      sendUserMessage: async (content, options) => {
        replayed.push({ content, deliverAs: options?.deliverAs })
      },
    }
    const state = registerTargetProviderFallback(api)

    await handlers.get("before_provider_request")?.(
      {
        payload: {
          body: {
            messages: [
              { role: "system", content: "rules" },
              { role: "user", content: [{ type: "text", text: "repair the failing test" }] },
            ],
          },
        },
      },
      {},
    )
    await handlers.get("after_provider_response")?.(
      { type: "after_provider_response", status: 429, headers: {} },
      {
        model: { provider: "test", id: "broken" },
        modelRegistry: {
          find: (provider: string, id: string) => ({ provider, id }),
        },
      },
    )
    await handlers.get("after_provider_response")?.(
      { type: "after_provider_response", status: 429, headers: {} },
      {
        model: { provider: "test", id: "broken" },
        modelRegistry: {
          find: (provider: string, id: string) => ({ provider, id }),
        },
      },
    )

    expect(replayed).toEqual([{ content: "repair the failing test", deliverAs: "followUp" }])
    expect(state).toMatchObject({ replayAttempts: 1, replayApplied: 1, lastPrompt: "repair the failing test" })
  })
})
