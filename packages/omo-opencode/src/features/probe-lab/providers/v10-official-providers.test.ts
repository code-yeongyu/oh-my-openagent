/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { startMockServer, type MockServer } from "./mock-server"
import { createGeminiOfficialProvider } from "./gemini-official-provider"
import { createOpencodeGoProvider } from "./opencode-go-provider"
import { createOpenRouterProvider } from "./openrouter-provider"
import { createOllamaLocalProvider } from "./ollama-local-provider"
import type { ProviderCredentials } from "./provider-types"

let server: MockServer | null = null

afterEach(() => {
  server?.close()
  server = null
})

function baseCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-x",
    name: "test",
    provider_type: "custom_http",
    base_url: "http://example.test",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({}),
    default_headers: null,
    rate_limit_rps: null,
    rate_limit_rpm: null,
    rate_limit_tpm: null,
    cooldown_on_429_s: 90,
    supported_models: null,
    health_check_url: null,
    health_check_interval_s: 300,
    status: "active",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

describe("gemini-official provider", () => {
  test("dispatchProbe #given mock returns 200 #when called #then x-goog-api-key header reaches server", async () => {
    const calls: string[] = []
    server = startMockServer((req) => {
      calls.push(req.headers.get("x-goog-api-key") ?? "")
      return new Response(JSON.stringify({ candidates: [] }), { status: 200, headers: { "content-type": "application/json" } })
    })
    const provider = createGeminiOfficialProvider(baseCreds({
      base_url: server.url,
      auth_config: JSON.stringify({ api_key: "AIzaXYZ" }),
    }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1beta/models/gemini-3.5-flash:generateContent`,
      method: "POST",
      headers: {},
      body: JSON.stringify({ contents: [] }),
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(calls[0]).toBe("AIzaXYZ")
  })

  test("dispatchProbe #given 429 response #when called #then ProbeError.kind is rate_limited", async () => {
    server = startMockServer(() => new Response("rl", { status: 429 }))
    const provider = createGeminiOfficialProvider(baseCreds({ base_url: server.url, auth_config: JSON.stringify({ api_key: "k" }) }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1beta/models/x:generateContent`,
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.error?.kind).toBe("rate_limited")
  })
})

describe("opencode-go provider", () => {
  test("dispatchProbe #given valid bearer token #when called #then Authorization Bearer header reaches server", async () => {
    const calls: string[] = []
    server = startMockServer((req) => {
      calls.push(req.headers.get("authorization") ?? "")
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    })
    const provider = createOpencodeGoProvider(baseCreds({ base_url: server.url, auth_config: JSON.stringify({ bearer_token: "tok-go" }) }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1/chat`,
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(calls[0]).toBe("Bearer tok-go")
  })
})

describe("openrouter provider", () => {
  test("dispatchProbe #given OpenRouter creds #when called #then HTTP-Referer + X-Title + Authorization headers all set", async () => {
    const seen: Record<string, string> = {}
    server = startMockServer((req) => {
      seen.auth = req.headers.get("authorization") ?? ""
      seen.referer = req.headers.get("http-referer") ?? ""
      seen.title = req.headers.get("x-title") ?? ""
      return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } })
    })
    const provider = createOpenRouterProvider(baseCreds({
      base_url: server.url,
      auth_config: JSON.stringify({ api_key: "sk-or", http_referer: "https://my.app", x_title: "MyApp" }),
    }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/api/v1/chat/completions`,
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(seen.auth).toBe("Bearer sk-or")
    expect(seen.referer).toBe("https://my.app")
    expect(seen.title).toBe("MyApp")
  })

  test("dispatchProbe #given 401 response #when called #then ProbeError.kind is blocked", async () => {
    server = startMockServer(() => new Response("nope", { status: 401 }))
    const provider = createOpenRouterProvider(baseCreds({ base_url: server.url, auth_config: JSON.stringify({ api_key: "x" }) }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/api/v1/chat/completions`,
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.error?.kind).toBe("blocked")
  })
})

describe("ollama-local provider", () => {
  test("dispatchProbe #given local mock /api/chat #when called #then no auth header is sent", async () => {
    let auth: string | null = null
    server = startMockServer((req) => {
      auth = req.headers.get("authorization")
      return new Response(JSON.stringify({ done: true }), { status: 200, headers: { "content-type": "application/json" } })
    })
    const provider = createOllamaLocalProvider(baseCreds({ base_url: server.url, auth_type: "none", auth_config: JSON.stringify({}) }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/api/chat`,
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(auth).toBeNull()
  })

  test("healthCheck #given /api/tags returns 200 #when called #then ok=true", async () => {
    server = startMockServer(() => new Response("[]", { status: 200 }))
    const provider = createOllamaLocalProvider(baseCreds({ base_url: server.url, auth_type: "none", auth_config: JSON.stringify({}) }))
    const result = await provider.healthCheck()
    expect(result.ok).toBe(true)
  })
})
