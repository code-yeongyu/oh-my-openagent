/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { __setCamoufoxDriverForTest } from "../replay-engine-dispatcher"
import { createClaudeWebReverseProvider } from "./claude-web-reverse-provider"
import { createGeminiWebReverseProvider } from "./gemini-web-reverse-provider"
import type { ProviderCredentials } from "./provider-types"

afterEach(() => {
  __setCamoufoxDriverForTest(null)
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

describe("claude-web-reverse provider", () => {
  test("dispatchProbe #given camoufox driver returns 200 with session cookie #when called #then ProbeResponse status=200 and Cookie header reaches driver", async () => {
    const seenHeaders: Record<string, string>[] = []
    __setCamoufoxDriverForTest(async (req) => {
      seenHeaders.push(req.headers)
      return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [] }), timing_ms: 50 }
    })
    const provider = createClaudeWebReverseProvider(baseCreds({
      base_url: "https://claude.ai",
      auth_config: JSON.stringify({ session_cookie: "sessionKey=abc123" }),
    }))
    const out = await provider.dispatchProbe({
      url: "https://claude.ai/api/append_message",
      method: "POST",
      headers: {},
      body: JSON.stringify({ prompt: "hi" }),
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(seenHeaders[0]?.Cookie).toBe("sessionKey=abc123")
  })

  test("dispatchProbe #given camoufox driver returns 401 #when called #then ProbeError.kind is blocked", async () => {
    __setCamoufoxDriverForTest(async () => ({ status: 401, headers: {}, body: "unauthorized", timing_ms: 10 }))
    const provider = createClaudeWebReverseProvider(baseCreds({ base_url: "https://claude.ai", auth_config: JSON.stringify({ session_cookie: "x" }) }))
    const out = await provider.dispatchProbe({
      url: "https://claude.ai/api/x",
      method: "GET",
      headers: {},
      body: undefined,
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.error?.kind).toBe("blocked")
  })
})

describe("gemini-web-reverse provider", () => {
  test("dispatchProbe #given camoufox driver returns 200 #when called #then session cookie reaches driver", async () => {
    const calls: Record<string, string>[] = []
    __setCamoufoxDriverForTest(async (req) => {
      calls.push(req.headers)
      return { status: 200, headers: {}, body: "{}", timing_ms: 25 }
    })
    const provider = createGeminiWebReverseProvider(baseCreds({
      base_url: "https://gemini.google.com",
      auth_config: JSON.stringify({ session_cookie: "Secure-1PSID=xyz" }),
    }))
    const out = await provider.dispatchProbe({
      url: "https://gemini.google.com/_/BardChatUi/data/x",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(calls[0]?.Cookie).toBe("Secure-1PSID=xyz")
  })
})
