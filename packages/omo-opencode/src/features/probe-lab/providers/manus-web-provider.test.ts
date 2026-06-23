/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { createManusWebProvider, __setManusFetchForTest } from "./manus-web-provider"
import { buildManusHeaders, parseManusAuthConfig } from "./manus-web-headers"
import { mapManusWebError } from "./manus-web-error-mapper"
import type { ProviderCredentials } from "./provider-types"

afterEach(() => {
  __setManusFetchForTest(null)
})

function makeCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-manus",
    name: "manus-web-test",
    provider_type: "manus_web",
    base_url: "https://api.manus.im",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({
      jwt_token: "eyJhbGc.payload.sig",
      user_id: "310519663713511581",
    }),
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

function mockResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init)
}

describe("manus-web headers + auth parsing", () => {
  test("parseManusAuthConfig #given valid JSON with jwt_token #when called #then returns parsed auth", () => {
    const out = parseManusAuthConfig(JSON.stringify({ jwt_token: "tok", user_id: "u1" }))
    expect(out.jwt_token).toBe("tok")
    expect(out.user_id).toBe("u1")
  })

  test("parseManusAuthConfig #given malformed JSON #when called #then returns empty token, no throw", () => {
    const out = parseManusAuthConfig("{not json")
    expect(out.jwt_token).toBe("")
  })

  test("parseManusAuthConfig #given null #when called #then returns empty token", () => {
    const out = parseManusAuthConfig(null)
    expect(out.jwt_token).toBe("")
  })

  test("buildManusHeaders #given jwt_token present #when called #then includes Bearer auth + standard headers", () => {
    const hdrs = buildManusHeaders({ jwt_token: "tok" }, {})
    expect(hdrs.Authorization).toBe("Bearer tok")
    expect(hdrs["Content-Type"]).toBe("application/json")
    expect(hdrs.Origin).toBe("https://manus.im")
    expect(hdrs.Referer).toBe("https://manus.im/")
  })

  test("buildManusHeaders #given empty jwt_token #when called #then omits Authorization", () => {
    const hdrs = buildManusHeaders({ jwt_token: "" }, {})
    expect(hdrs.Authorization).toBeUndefined()
  })

  test("buildManusHeaders #given custom header override #when called #then custom wins over default", () => {
    const hdrs = buildManusHeaders({ jwt_token: "tok" }, { "Content-Type": "application/grpc-web+json" })
    expect(hdrs["Content-Type"]).toBe("application/grpc-web+json")
  })
})

describe("manus-web error mapper", () => {
  test("mapManusWebError #given 200 status #when called #then returns undefined", () => {
    expect(mapManusWebError(200, null, null)).toBeUndefined()
  })

  test("mapManusWebError #given 401 status #when called #then returns blocked kind", () => {
    const err = mapManusWebError(401, '{"code":"unauthenticated"}', null)
    expect(err?.kind).toBe("blocked")
    expect(err?.http_status).toBe(401)
    expect(err?.retryable).toBe(false)
  })

  test("mapManusWebError #given 429 status #when called #then returns rate_limited retryable", () => {
    const err = mapManusWebError(429, null, null)
    expect(err?.kind).toBe("rate_limited")
    expect(err?.retryable).toBe(true)
  })

  test("mapManusWebError #given 503 status #when called #then returns http_error retryable", () => {
    const err = mapManusWebError(503, null, null)
    expect(err?.kind).toBe("http_error")
    expect(err?.retryable).toBe(true)
  })

  test("mapManusWebError #given timeout error message #when called #then returns timeout kind", () => {
    const err = mapManusWebError(null, null, "request aborted: timeout")
    expect(err?.kind).toBe("timeout")
  })
})

describe("manus-web provider", () => {
  test("dispatchProbe #given mock returns 200 JSON #when called #then ProbeResponse mirrors body and Bearer header reaches fetch", async () => {
    const calls: Array<{ headers: Record<string, string>; url: string }> = []
    __setManusFetchForTest(async (url, init) => {
      const headers = init.headers as Record<string, string>
      calls.push({ url, headers })
      return mockResponse(JSON.stringify({ ok: true }), { status: 200 })
    })
    const provider = createManusWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://api.manus.im/session.v1.SessionService/ListSessions",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(out.error).toBeUndefined()
    expect(JSON.parse(out.body).ok).toBe(true)
    expect(calls[0]?.headers.Authorization).toBe("Bearer eyJhbGc.payload.sig")
  })

  test("dispatchProbe #given mock returns 401 #when called #then error.kind=blocked, retryable=false", async () => {
    __setManusFetchForTest(async () =>
      mockResponse('{"code":"unauthenticated","message":"token expired"}', { status: 401 }),
    )
    const provider = createManusWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://api.manus.im/session.v1.SessionService/ListSessions",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(401)
    expect(out.error?.kind).toBe("blocked")
    expect(out.error?.retryable).toBe(false)
  })

  test("dispatchProbe #given fetch throws abort error #when called #then error.kind=timeout, status=0", async () => {
    __setManusFetchForTest(async () => {
      throw new Error("request aborted: timeout")
    })
    const provider = createManusWebProvider(makeCreds())
    const out = await provider.dispatchProbe({
      url: "https://api.manus.im/session.v1.SessionService/ListSessions",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(0)
    expect(out.error?.kind).toBe("timeout")
  })

  test("healthCheck #given UserInfo returns 200 #when called #then ok=true", async () => {
    __setManusFetchForTest(async () =>
      mockResponse(JSON.stringify({ userId: "u1", email: "x@y.z" }), { status: 200 }),
    )
    const provider = createManusWebProvider(makeCreds())
    const result = await provider.healthCheck()
    expect(result.ok).toBe(true)
    expect(result.status_code).toBe(200)
  })

  test("healthCheck #given UserInfo returns 401 #when called #then ok=false with JWT expired message", async () => {
    __setManusFetchForTest(async () =>
      mockResponse('{"code":"unauthenticated"}', { status: 401 }),
    )
    const provider = createManusWebProvider(makeCreds())
    const result = await provider.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.status_code).toBe(401)
    expect(result.message).toContain("JWT")
  })

  test("healthCheck #given auth_config without jwt_token #when called #then ok=false with missing-token message", async () => {
    const provider = createManusWebProvider(makeCreds({ auth_config: JSON.stringify({}) }))
    const result = await provider.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.message).toContain("missing jwt_token")
  })

  test("refreshCredentials #given refresh_type=jwt_token #when called #then success=false with not-implemented note", async () => {
    const provider = createManusWebProvider(makeCreds())
    const result = await provider.refreshCredentials("jwt_token")
    expect(result.success).toBe(false)
    expect(result.message).toContain("not yet implemented")
  })

  test("refreshCredentials #given unknown refresh_type #when called #then success=false", async () => {
    const provider = createManusWebProvider(makeCreds())
    const result = await provider.refreshCredentials("aws_waf_token")
    expect(result.success).toBe(false)
  })

  test("getErrorTaxonomy + getSupportedModels + getRateLimits #given default creds #when called #then return expected shapes", () => {
    const provider = createManusWebProvider(makeCreds({
      supported_models: JSON.stringify(["manus-agent-v1"]),
      rate_limit_rps: 1,
      rate_limit_rpm: 60,
    }))
    expect(provider.kind).toBe("manus_web")
    expect(provider.getSupportedModels()).toEqual(["manus-agent-v1"])
    expect(provider.getRateLimits().rps).toBe(1)
    expect(provider.getErrorTaxonomy().blocked_signals).toContain("401_unauthorized")
  })
})
