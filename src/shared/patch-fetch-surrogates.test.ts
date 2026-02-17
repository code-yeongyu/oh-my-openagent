import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { patchFetchForSurrogates } from "./patch-fetch-surrogates"

describe("patchFetchForSurrogates", () => {
  let originalFetch: typeof globalThis.fetch
  let lastCallBody: string | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
    const marker = Symbol.for("omo.fetch.surrogateSanitized")
    delete (globalThis as Record<symbol, unknown>)[marker]

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      lastCallBody = typeof init?.body === "string" ? init.body : undefined
      return new Response("ok")
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    lastCallBody = undefined
  })

  it("sanitizes lone surrogates in string body", async () => {
    patchFetchForSurrogates()
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "hello\uD800world",
    })
    expect(lastCallBody).toBe("hello\uFFFDworld")
  })

  it("preserves clean string body unchanged", async () => {
    patchFetchForSurrogates()
    const clean = '{"messages":[{"role":"user","content":"hello"}]}'
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: clean,
    })
    expect(lastCallBody).toBe(clean)
  })

  it("preserves valid surrogate pairs (emoji)", async () => {
    patchFetchForSurrogates()
    const withEmoji = '{"content":"test \uD83D\uDE00 emoji"}'
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: withEmoji,
    })
    expect(lastCallBody).toBe(withEmoji)
  })

  it("does not break non-string bodies", async () => {
    patchFetchForSurrogates()
    await globalThis.fetch("https://example.com", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]) as unknown as BodyInit,
    })
    expect(lastCallBody).toBeUndefined()
  })

  it("only patches once (idempotent)", async () => {
    let callCount = 0
    const mockFetch = globalThis.fetch
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      callCount++
      return mockFetch(...args)
    }

    patchFetchForSurrogates()
    patchFetchForSurrogates()
    patchFetchForSurrogates()

    await globalThis.fetch("https://example.com", { body: "test\uD800" })
    expect(callCount).toBe(1)
  })

  it("handles fetch with no init", async () => {
    patchFetchForSurrogates()
    const result = await globalThis.fetch("https://example.com")
    expect(result.status).toBe(200)
  })
})
