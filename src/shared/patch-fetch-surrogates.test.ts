import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { patchFetchForSurrogates } from "./patch-fetch-surrogates"

describe("patchFetchForSurrogates", () => {
  let originalFetch: typeof globalThis.fetch
  let lastCallBody: string | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
    const marker = Symbol.for("omo.fetch.surrogateSanitized")
    delete (globalThis as Record<symbol, unknown>)[marker]

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body && typeof init.body === "string") {
        lastCallBody = init.body
      } else if (input instanceof Request && input.body !== null) {
        lastCallBody = await input.clone().text()
      } else {
        lastCallBody = undefined
      }
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

  it("only patches once (idempotent)", () => {
    patchFetchForSurrogates()
    const fetchAfterFirst = globalThis.fetch

    patchFetchForSurrogates()
    patchFetchForSurrogates()

    expect(globalThis.fetch).toBe(fetchAfterFirst)

    const marker = Symbol.for("omo.fetch.surrogateSanitized")
    expect((globalThis as Record<symbol, unknown>)[marker]).toBeTruthy()
  })

  it("handles fetch with no init", async () => {
    patchFetchForSurrogates()
    const result = await globalThis.fetch("https://example.com")
    expect(result.status).toBe(200)
  })

  it("sanitizes lone surrogate JSON escape sequences", async () => {
    patchFetchForSurrogates()
    const body = '{"content":"test\\uD800value"}'
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body,
    })
    expect(lastCallBody).toBe('{"content":"test\\uFFFDvalue"}')
  })

  it("preserves valid surrogate pair JSON escape sequences", async () => {
    patchFetchForSurrogates()
    const body = '{"content":"emoji\\uD83D\\uDE00here"}'
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body,
    })
    expect(lastCallBody).toBe(body)
  })

  it("sanitizes lone low surrogate JSON escape sequences", async () => {
    patchFetchForSurrogates()
    const body = '{"content":"bad\\uDC00end"}'
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body,
    })
    expect(lastCallBody).toBe('{"content":"bad\\uFFFDend"}')
  })

  it("handles both literal and escape surrogates in same body", async () => {
    patchFetchForSurrogates()
    const body = '{"a":"lit\uD800eral","b":"esc\\uD800ape"}'
    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body,
    })
    expect(lastCallBody).toBe('{"a":"lit\uFFFDeral","b":"esc\\uFFFDape"}')
  })

  it("sanitizes body in fetch(Request) signature", async () => {
    patchFetchForSurrogates()
    const req = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "hello\uD800world",
    })
    await globalThis.fetch(req)
    expect(lastCallBody).toBe("hello\uFFFDworld")
  })

  it("sanitizes JSON escape surrogates in fetch(Request)", async () => {
    patchFetchForSurrogates()
    const req = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: '{"content":"\\uD800test"}',
    })
    await globalThis.fetch(req)
    expect(lastCallBody).toBe('{"content":"\\uFFFDtest"}')
  })

  it("preserves clean Request body unchanged", async () => {
    patchFetchForSurrogates()
    const body = '{"content":"clean text"}'
    const req = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body,
    })
    await globalThis.fetch(req)
    expect(lastCallBody).toBe(body)
  })
})
