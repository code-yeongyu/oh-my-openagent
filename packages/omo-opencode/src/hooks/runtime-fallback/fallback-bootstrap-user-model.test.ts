import { describe, expect, test } from "bun:test"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { createRuntimeFallbackRetryTextPart } from "../../shared/runtime-fallback-retry-marker"

const real = {
  info: { role: "user", model: { providerID: "openai", modelID: "actual" } },
  parts: [{ type: "text", text: "Implement the requested fix" }],
}

function options(messages: unknown, eventModel?: string) {
  return {
    sessionID: "session-bootstrap", source: "test", eventModel, resolvedAgent: "oracle",
    pluginConfig: { agents: { oracle: { model: "anthropic/configured" } } },
    ctx: { directory: "/qa", client: { session: { messages: async () => messages } } },
  }
}

describe("fallback bootstrap persisted user model", () => {
  test("prefers persisted real user model to configured agent model", async () => {
    expect(await resolveFallbackBootstrapModel(options({ data: [real] }))).toBe("openai/actual")
  })

  test("ignores newer synthetic continuation and compaction rows", async () => {
    expect(await resolveFallbackBootstrapModel(options({ data: [
      real,
      { info: { role: "user", model: "wrong/synthetic" }, parts: [createRuntimeFallbackRetryTextPart("continue")] },
      { info: { role: "user", model: "wrong/compaction" }, parts: [{ type: "compaction" }, { type: "text", text: "summary" }] },
    ] }))).toBe("openai/actual")
  })

  test("preserves a retry-marked real prompt and reads info.parts when top-level parts are empty", async () => {
    expect(await resolveFallbackBootstrapModel(options({ data: [
      real,
      { info: { role: "user", model: "openai/newest", parts: [createRuntimeFallbackRetryTextPart("Continue implementing the fix")] }, parts: [] },
    ] }))).toBe("openai/newest")
  })

  test("ordinary literal continue is still a real user prompt", async () => {
    expect(await resolveFallbackBootstrapModel(options({ data: [
      real,
      { info: { role: "user", model: "openai/continue", parts: [{ type: "text", text: "continue" }] } },
    ] }))).toBe("openai/continue")
  })

  test("explicit event model remains authoritative without a messages request", async () => {
    const input = options({ data: [real] }, "google/event-model")
    input.ctx.client.session.messages = async () => { throw new Error("must not read messages") }
    expect(await resolveFallbackBootstrapModel(input)).toBe("google/event-model")
  })

  test("falls back to configured model when there is no substantive persisted user", async () => {
    expect(await resolveFallbackBootstrapModel(options({ data: [
      { info: { role: "user", model: "wrong/synthetic" }, parts: [createRuntimeFallbackRetryTextPart("continue")] },
    ] }))).toBe("anthropic/configured")
  })

  test("falls back to configured model when session message lookup fails", async () => {
    const input = options(undefined)
    input.ctx.client.session.messages = async () => { throw new Error("lookup unavailable") }
    expect(await resolveFallbackBootstrapModel(input)).toBe("anthropic/configured")
  })
})
