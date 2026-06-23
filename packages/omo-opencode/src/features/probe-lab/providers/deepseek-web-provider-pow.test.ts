/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { __setCurlCffiDriverForTest } from "../replay-engine-dispatcher"
import { createDeepSeekWebProvider, __setPowChallengeFetcherForTest } from "./deepseek-web-provider"
import type { ProviderCredentials } from "./provider-types"
import { dsHashV1 } from "../pow/deepseek-hash-v1/hash"
import { bytesToHex } from "../pow/deepseek-hash-v1/bytes-codec"
import { buildPrefix } from "../pow/deepseek-hash-v1/types"

afterEach(() => {
  __setCurlCffiDriverForTest(null)
  __setPowChallengeFetcherForTest(null)
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

describe("deepseek-web provider PoW", () => {
  test("dispatchProbe #given auto_solve_pow=true and target_path=/api/v0/chat/completion #when called #then PoW header is attached and driver receives X-DS-PoW-Response", async () => {
    const enc = new TextEncoder()
    const salt = "5f354fee5d6a540d5de2"
    const expireAt = 1778181967834
    const plantedNonce = 23
    const targetBytes = dsHashV1(enc.encode(buildPrefix(salt, expireAt) + plantedNonce.toString()))
    const challenge = {
      algorithm: "DeepSeekHashV1" as const,
      challenge: bytesToHex(targetBytes),
      salt,
      signature: "ab".repeat(32),
      difficulty: plantedNonce + 100,
      expire_at: expireAt,
      expire_after: 300000,
      target_path: "/api/v0/chat/completion",
    }
    let fetchCount = 0
    __setPowChallengeFetcherForTest(async () => { fetchCount++; return { challenge, cookies: "" } })
    const driverCalls: Array<{ headers: Record<string, string> }> = []
    __setCurlCffiDriverForTest(async (req) => {
      driverCalls.push({ headers: req.headers })
      return { status: 200, headers: {}, body: "{}", timing_ms: 5 }
    })
    const provider = createDeepSeekWebProvider(makeCreds({
      auth_config: JSON.stringify({ aws_waf_token: "waf-x", session_cookie: "ds=y", auto_solve_pow: true }),
    }))
    const out = await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(out.status).toBe(200)
    expect(fetchCount).toBe(1)
    const sent = driverCalls[0]?.headers ?? {}
    expect(sent.Cookie).toBe("aws-waf-token=waf-x; ds=y")
    expect(sent["X-DS-PoW-Response"]).toBeTruthy()
    const decoded = JSON.parse(Buffer.from(sent["X-DS-PoW-Response"]!, "base64").toString("utf8")) as Record<string, unknown>
    expect(decoded["answer"]).toBe(plantedNonce)
    expect(decoded["challenge"]).toBe(challenge.challenge)
    expect(decoded["target_path"]).toBe("/api/v0/chat/completion")
  })

  test("dispatchProbe #given auto_solve_pow=true and challenge response sets ds_session_id #when called #then driver receives the challenge cookie appended to existing auth cookies", async () => {
    const enc = new TextEncoder()
    const salt = "5f354fee5d6a540d5de2"
    const expireAt = 1778181967834
    const plantedNonce = 29
    const targetBytes = dsHashV1(enc.encode(buildPrefix(salt, expireAt) + plantedNonce.toString()))
    const challenge = {
      algorithm: "DeepSeekHashV1" as const,
      challenge: bytesToHex(targetBytes),
      salt,
      signature: "ab".repeat(32),
      difficulty: plantedNonce + 100,
      expire_at: expireAt,
      expire_after: 300000,
      target_path: "/api/v0/chat/completion",
    }
    __setPowChallengeFetcherForTest(async () => ({ challenge, cookies: "ds_session_id=abc123" }))
    const driverCalls: Array<{ headers: Record<string, string> }> = []
    __setCurlCffiDriverForTest(async (req) => {
      driverCalls.push({ headers: req.headers })
      return { status: 200, headers: {}, body: "{}", timing_ms: 5 }
    })
    const provider = createDeepSeekWebProvider(makeCreds({
      auth_config: JSON.stringify({ aws_waf_token: "waf-x", session_cookie: "ds=y", auto_solve_pow: true }),
    }))
    await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(driverCalls[0]?.headers.Cookie).toBe("aws-waf-token=waf-x; ds=y; ds_session_id=abc123")
  })

  test("dispatchProbe #given auto_solve_pow=false (default) #when called against /chat/completion #then no PoW fetch happens", async () => {
    let fetchCount = 0
    __setPowChallengeFetcherForTest(async () => { fetchCount++; throw new Error("should not be called") })
    __setCurlCffiDriverForTest(async () => ({ status: 200, headers: {}, body: "{}", timing_ms: 5 }))
    const provider = createDeepSeekWebProvider(makeCreds())
    await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/chat/completion",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(fetchCount).toBe(0)
  })

  test("dispatchProbe #given auto_solve_pow=true but URL is non-completion #when called #then no PoW fetch happens", async () => {
    let fetchCount = 0
    __setPowChallengeFetcherForTest(async () => { fetchCount++; throw new Error("should not be called") })
    __setCurlCffiDriverForTest(async () => ({ status: 200, headers: {}, body: "{}", timing_ms: 5 }))
    const provider = createDeepSeekWebProvider(makeCreds({
      auth_config: JSON.stringify({ auto_solve_pow: true }),
    }))
    await provider.dispatchProbe({
      url: "https://chat.deepseek.com/api/v0/users/login",
      method: "POST",
      headers: {},
      body: "{}",
      timeout_ms: 5000,
      forward_as_is: false,
      metadata: { session_id: "s-1", exchange_sequence: 1 },
    })
    expect(fetchCount).toBe(0)
  })
})
