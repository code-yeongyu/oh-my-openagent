/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { startMockServer, type MockServer } from "./mock-server"
import { createDs2ApiProvider } from "./ds2api-provider"
import type { ProviderCredentials } from "./provider-types"

let server: MockServer | null = null

afterEach(() => {
  server?.close()
  server = null
})

function makeCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-ds2api",
    name: "ds2api-test",
    provider_type: "openai_compatible",
    base_url: "http://example.test",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({ bearer_token: "tok-1" }),
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

function buildRequest(url: string): Parameters<ReturnType<typeof createDs2ApiProvider>["dispatchProbe"]>[0] {
  return {
    url,
    method: "POST",
    headers: {},
    body: JSON.stringify({ ping: true }),
    timeout_ms: 5000,
    forward_as_is: false,
    metadata: { session_id: "s-1", exchange_sequence: 1 },
  }
}

describe("ds2api provider", () => {
  test("dispatchProbe #given mock returns 200 + body #when called #then ProbeResponse mirrors status and body", async () => {
    server = startMockServer((req) => {
      const auth = req.headers.get("authorization")
      if (auth !== "Bearer tok-1") return new Response("missing auth", { status: 401 })
      return new Response("hello", { status: 200, headers: { "x-probe": "ok" } })
    })
    const provider = createDs2ApiProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe(buildRequest(`${server.url}/v1/chat/completions`))
    expect(out.status).toBe(200)
    expect(out.body).toBe("hello")
    expect(out.error).toBeUndefined()
  })

  test("dispatchProbe #given mock returns 200 + empty SSE body #when called #then ProbeError.kind is rate_limited", async () => {
    server = startMockServer(() => new Response("", { status: 200 }))
    const provider = createDs2ApiProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe(buildRequest(`${server.url}/v1/chat/completions`))
    expect(out.status).toBe(200)
    expect(out.error?.kind).toBe("rate_limited")
  })

  test("dispatchProbe #given mock returns 403 #when called #then ProbeError.kind is blocked", async () => {
    server = startMockServer(() => new Response("forbidden", { status: 403 }))
    const provider = createDs2ApiProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe(buildRequest(`${server.url}/v1/chat/completions`))
    expect(out.status).toBe(403)
    expect(out.error?.kind).toBe("blocked")
  })
})
