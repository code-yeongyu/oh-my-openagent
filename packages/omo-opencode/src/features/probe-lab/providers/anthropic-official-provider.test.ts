/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { startMockServer, type MockServer } from "./mock-server"
import { createAnthropicOfficialProvider } from "./anthropic-official-provider"
import type { ProviderCredentials } from "./provider-types"

let server: MockServer | null = null

afterEach(() => {
  server?.close()
  server = null
})

function makeCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-anthropic",
    name: "anthropic-test",
    provider_type: "anthropic",
    base_url: "http://example.test",
    auth_type: "api_key_header",
    auth_config: JSON.stringify({ api_key: "sk-ant-test" }),
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

describe("anthropic-official provider", () => {
  test("dispatchProbe #given mock returns Anthropic-shape JSON #when called #then ProbeResponse mirrors body and x-api-key + anthropic-version reach mock", async () => {
    server = startMockServer((req) => {
      const apiKey = req.headers.get("x-api-key")
      const version = req.headers.get("anthropic-version")
      if (apiKey !== "sk-ant-test" || version !== "2023-06-01") {
        return new Response("missing headers", { status: 401 })
      }
      return new Response(JSON.stringify({ id: "msg_01", type: "message" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const provider = createAnthropicOfficialProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1/messages`,
      method: "POST",
      headers: {},
      body: JSON.stringify({ model: "claude-3-haiku", max_tokens: 16, messages: [] }),
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    const parsed = JSON.parse(out.body) as { id: string }
    expect(parsed.id).toBe("msg_01")
    expect(out.error).toBeUndefined()
  })

  test("dispatchProbe #given mock returns 529 overloaded #when called #then ProbeError.kind is rate_limited", async () => {
    server = startMockServer(() => new Response("overloaded", { status: 529 }))
    const provider = createAnthropicOfficialProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1/messages`,
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
