/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import {
  __setCurlCffiDriverForTest,
} from "../replay-engine-dispatcher"
import { createDeepSeekWebProvider } from "./deepseek-web-provider"
import type { ProviderCredentials } from "./provider-types"

afterEach(() => {
  __setCurlCffiDriverForTest(null)
})

function makeCreds(overrides: Partial<ProviderCredentials> = {}): ProviderCredentials {
  return {
    id: "p-deepseek-proxy",
    name: "deepseek-web-proxy-test",
    provider_type: "deepseek_web",
    base_url: "http://127.0.0.1:1",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({ bearer_token: "tok-x", auto_solve_pow: false }),
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

describe("createDeepSeekWebProvider proxy plumbing", () => {
  describe("#given default_headers contains __proxy_url__", () => {
    test("#when dispatchProbe is called #then cycletls driver is NOT called (curl subprocess path)", async () => {
      let cycletlsCalled = false
      __setCurlCffiDriverForTest(async () => {
        cycletlsCalled = true
        return { status: 200, headers: {}, body: "{}", timing_ms: 1 }
      })
      const provider = createDeepSeekWebProvider(makeCreds({
        default_headers: JSON.stringify({
          __proxy_url__: "socks5h://nope:nope@127.0.0.1:1",
          "X-App-Version": "20241129.1",
        }),
      }))
      const result = await provider.dispatchProbe({
        url: "http://127.0.0.1:1/api/v0/chat_session/create",
        method: "POST",
        headers: {},
        body: "{}",
        timeout_ms: 2_000,
        forward_as_is: false,
        metadata: { session_id: "s-1", exchange_sequence: 1 },
      })
      expect(cycletlsCalled).toBe(false)
      expect(result.status).toBe(0)
    })
  })

  describe("#given default_headers does NOT contain __proxy_url__", () => {
    test("#when dispatchProbe is called #then cycletls driver IS called with proxy=null and merged headers", async () => {
      const captured: Array<{ proxy?: string | null; headers: Record<string, string> }> = []
      __setCurlCffiDriverForTest(async (req) => {
        captured.push({ proxy: req.proxy, headers: req.headers })
        return { status: 200, headers: {}, body: "{}", timing_ms: 1 }
      })
      const provider = createDeepSeekWebProvider(makeCreds({
        default_headers: JSON.stringify({ "X-App-Version": "20241129.1" }),
      }))
      await provider.dispatchProbe({
        url: "http://127.0.0.1/api/v0/chat_session/create",
        method: "POST",
        headers: {},
        body: "{}",
        timeout_ms: 5_000,
        forward_as_is: false,
        metadata: { session_id: "s-1", exchange_sequence: 1 },
      })
      expect(captured).toHaveLength(1)
      expect(captured[0]?.proxy).toBeNull()
      expect(captured[0]?.headers["X-App-Version"]).toBe("20241129.1")
      expect(captured[0]?.headers["Authorization"]).toBe("Bearer tok-x")
    })
  })
})
