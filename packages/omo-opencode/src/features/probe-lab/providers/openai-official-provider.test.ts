/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { startMockServer, type MockServer } from "./mock-server"
import { createOpenAIOfficialProvider } from "./openai-official-provider"
import type { ProviderCredentials } from "./provider-types"

let server: MockServer | null = null

afterEach(() => {
  server?.close()
  server = null
})

function makeCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-openai",
    name: "openai-test",
    provider_type: "openai_compatible",
    base_url: "http://example.test",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({ api_key: "sk-test" }),
    default_headers: null,
    rate_limit_rps: null,
    rate_limit_rpm: null,
    rate_limit_tpm: null,
    cooldown_on_429_s: 90,
    supported_models: JSON.stringify(["gpt-4o-mini"]),
    health_check_url: null,
    health_check_interval_s: 300,
    status: "active",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

describe("openai-official provider", () => {
  test("dispatchProbe #given mock returns OpenAI-shape JSON #when called #then ProbeResponse mirrors body and Authorization header reaches mock", async () => {
    server = startMockServer((req) => {
      const auth = req.headers.get("authorization")
      if (auth !== "Bearer sk-test") return new Response("missing auth", { status: 401 })
      return new Response(JSON.stringify({ id: "chatcmpl-1", object: "chat.completion" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const provider = createOpenAIOfficialProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1/chat/completions`,
      method: "POST",
      headers: {},
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    const parsed = JSON.parse(out.body) as { id: string }
    expect(parsed.id).toBe("chatcmpl-1")
    expect(out.error).toBeUndefined()
  })

  test("dispatchProbe #given mock returns 401 #when called #then ProbeError.kind is blocked", async () => {
    server = startMockServer(() => new Response("unauth", { status: 401 }))
    const provider = createOpenAIOfficialProvider(makeCreds({ base_url: server.url }))
    const out = await provider.dispatchProbe({
      url: `${server.url}/v1/chat/completions`,
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
