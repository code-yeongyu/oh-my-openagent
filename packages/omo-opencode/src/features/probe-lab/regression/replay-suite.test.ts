/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { runRegressionSuite, type RegressionCase } from "./replay-suite"
import { startMockServer, type MockServer } from "../providers/mock-server"
import { createOpenAIOfficialProvider } from "../providers/openai-official-provider"
import { createGeminiOfficialProvider } from "../providers/gemini-official-provider"
import { createOpenRouterProvider } from "../providers/openrouter-provider"
import type { ProviderCredentials } from "../providers/provider-types"

let server: MockServer | null = null

afterEach(() => {
  server?.close()
  server = null
})

function baseCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-r",
    name: "regression",
    provider_type: "custom_http",
    base_url: "http://example.test",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({ api_key: "k" }),
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

describe("replay-based regression suite v1.0", () => {
  test("runRegressionSuite #given openai provider + 200 mock #when run #then case passes", async () => {
    server = startMockServer(() => new Response(JSON.stringify({ id: "ok" }), { status: 200, headers: { "content-type": "application/json" } }))
    const provider = createOpenAIOfficialProvider(baseCreds({ base_url: server.url, auth_config: JSON.stringify({ api_key: "k" }) }))
    const cases: RegressionCase[] = [{
      name: "openai-200-baseline",
      request: { url: `${server.url}/v1/chat/completions`, method: "POST", headers: {}, body: "{}", timeout_ms: 5000, forward_as_is: false },
      expected: { status: 200, error_kind: null, body_contains: "ok" },
    }]
    const results = await runRegressionSuite(provider, cases)
    expect(results[0]?.ok).toBe(true)
  })

  test("runRegressionSuite #given expected status differs #when run #then case fails with reason", async () => {
    server = startMockServer(() => new Response("err", { status: 500 }))
    const provider = createGeminiOfficialProvider(baseCreds({ base_url: server.url, auth_config: JSON.stringify({ api_key: "k" }) }))
    const cases: RegressionCase[] = [{
      name: "gemini-expects-200-gets-500",
      request: { url: `${server.url}/v1beta/models/x:generateContent`, method: "POST", headers: {}, body: "{}", timeout_ms: 5000, forward_as_is: false },
      expected: { status: 200 },
    }]
    const results = await runRegressionSuite(provider, cases)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.reason).toContain("status mismatch")
  })

  test("runRegressionSuite #given multiple cases #when run #then all are evaluated independently", async () => {
    server = startMockServer((req) => req.url.endsWith("/api/v1/chat/completions") ? new Response(JSON.stringify({ choices: [] }), { status: 200 }) : new Response("nope", { status: 401 }))
    const provider = createOpenRouterProvider(baseCreds({ base_url: server.url, auth_config: JSON.stringify({ api_key: "k" }) }))
    const cases: RegressionCase[] = [
      { name: "ok", request: { url: `${server.url}/api/v1/chat/completions`, method: "POST", headers: {}, body: "{}", timeout_ms: 5000, forward_as_is: false }, expected: { status: 200, error_kind: null } },
      { name: "401", request: { url: `${server.url}/api/v1/auth-required`, method: "POST", headers: {}, body: "{}", timeout_ms: 5000, forward_as_is: false }, expected: { error_kind: "blocked" } },
    ]
    const results = await runRegressionSuite(provider, cases)
    expect(results[0]?.ok).toBe(true)
    expect(results[1]?.ok).toBe(true)
  })
})
