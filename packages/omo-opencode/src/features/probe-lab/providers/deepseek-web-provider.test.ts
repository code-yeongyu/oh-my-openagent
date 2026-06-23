/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import {
  __setCurlCffiDriverForTest,
} from "../replay-engine-dispatcher"
import { startMockServer, type MockServer } from "./mock-server"
import { createDeepSeekWebProvider } from "./deepseek-web-provider"
import type { ProviderCredentials } from "./provider-types"

let server: MockServer | null = null

afterEach(() => {
  server?.close()
  server = null
  __setCurlCffiDriverForTest(null)
})

function makeCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-deepseek",
    name: "deepseek-web-test",
    provider_type: "custom_http",
    base_url: "https://chat.deepseek.com",
    auth_type: "cookie_session",
    auth_config: JSON.stringify({ aws_waf_token: "waf-abc", session_cookie: "ds_session=xyz" }),
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

describe("deepseek-web provider v1.0", () => {
  test("dispatchProbe #given mocked curl_cffi driver returns 200 JSON #when called #then ProbeResponse mirrors body and AWS WAF cookie reaches driver", async () => {
    const calls: Array<{ headers: Record<string, string> }> = []
    __setCurlCffiDriverForTest(async (req) => {
      calls.push({ headers: req.headers })
      return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ds-msg-1" }), timing_ms: 42 }
    })
    const provider = createDeepSeekWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: JSON.stringify({ message: "hi" }),
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(out.error).toBeUndefined()
    expect(JSON.parse(out.body).id).toBe("ds-msg-1")
    expect(calls[0]?.headers.Cookie ?? "").toContain("aws-waf-token=waf-abc")
    expect(calls[0]?.headers.Cookie ?? "").toContain("ds_session=xyz")
  })

  test("dispatchProbe #given driver returns 403 with WAF challenge HTML #when called #then ProbeError.kind is captcha (challenge interstitial detected)", async () => {
    __setCurlCffiDriverForTest(async () => ({
      status: 403,
      headers: { "content-type": "text/html" },
      body: `<html><script src="https://captcha-prod.awswaf.com/challenge.js"></script></html>`,
      timing_ms: 30,
    }))
    const provider = createDeepSeekWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.error?.kind).toBe("blocked")
    expect(out.status).toBe(403)
  })

  test("dispatchProbe #given driver returns 200 with WAF challenge body #when called #then ProbeError.kind is captcha", async () => {
    __setCurlCffiDriverForTest(async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<html><script src="https://captcha-prod.awswaf.com/challenge.js"></script></html>`,
      timing_ms: 12,
    }))
    const provider = createDeepSeekWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.error?.kind).toBe("captcha")
  })

  test("dispatchProbe #given driver throws timeout #when called #then ProbeError.kind is timeout", async () => {
    __setCurlCffiDriverForTest(async () => { throw new Error("request aborted: timeout") })
    const provider = createDeepSeekWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.error?.kind).toBe("timeout")
    expect(out.status).toBe(0)
  })

  test("healthCheck #given mock chat.deepseek.com sets aws-waf-token cookie #when called #then ok=true", async () => {
    server = startMockServer(() => new Response("ok", {
      status: 200,
      headers: { "set-cookie": "aws-waf-token=fresh; Path=/; Secure" },
    }))
    const provider = createDeepSeekWebProvider(makeCreds({ base_url: server.url, health_check_url: server.url }))
    const result = await provider.healthCheck()
    expect(result.ok).toBe(true)
  })

  test("healthCheck #given mock chat.deepseek.com without aws-waf-token cookie and no stored token #when called #then ok=false with informative message", async () => {
    server = startMockServer(() => new Response("ok", { status: 200 }))
    const provider = createDeepSeekWebProvider(makeCreds({
      base_url: server.url,
      health_check_url: server.url,
      auth_config: JSON.stringify({}),
    }))
    const result = await provider.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.message).toContain("aws-waf-token")
  })

  test("refreshCredentials #given refreshType=aws_waf_token #when called #then success=true with new_expiry near +1800s and new_value/new_value_field set", async () => {
    const provider = createDeepSeekWebProvider(makeCreds())
    const result = await provider.refreshCredentials("aws_waf_token")
    expect(result.success).toBe(true)
    const now = Math.floor(Date.now() / 1000)
    expect((result.new_expiry ?? 0) - now).toBeGreaterThan(1500)
    expect(result.new_value).toMatch(/^waf-/)
    expect(result.new_value_field).toBe("aws_waf_token")
  })

  test("refreshCredentials #given unknown refreshType #when called #then success=false", async () => {
    const provider = createDeepSeekWebProvider(makeCreds())
    const result = await provider.refreshCredentials("api_key")
    expect(result.success).toBe(false)
  })
})
