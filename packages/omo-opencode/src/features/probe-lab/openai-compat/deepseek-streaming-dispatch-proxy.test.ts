import { describe, expect, it } from "bun:test"
import { dispatchStreamingCompletion } from "./deepseek-streaming-dispatch"
import type { CurlStreamInput } from "./streaming-via-curl"
import type { ProviderCredentials } from "../providers/provider-types"

function makeCreds(default_headers: Record<string, string>): ProviderCredentials {
  return {
    id: "p-test",
    name: "test",
    provider_type: "deepseek_web",
    base_url: "https://chat.deepseek.com",
    auth_type: "bearer_token",
    auth_config: JSON.stringify({ bearer_token: "tok-abc", auto_solve_pow: false }),
    default_headers: JSON.stringify(default_headers),
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
  }
}

describe("dispatchStreamingCompletion proxy routing", () => {
  describe("#given default_headers contains __proxy_url__", () => {
    it("#when invoked #then routes through curl dispatcher with proxyUrl", async () => {
      let captured: CurlStreamInput | null = null
      const fakeCurl = async (input: CurlStreamInput) => {
        captured = input
        return {
          ok: true as const,
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode("data: {}\n\n"))
              c.close()
            },
          }),
        }
      }
      const creds = makeCreds({
        __proxy_url__: "socks5h://user:pass@proxy.host:20000",
        "X-App-Version": "20241129.1",
        Origin: "https://chat.deepseek.com",
      })
      const result = await dispatchStreamingCompletion({
        baseUrl: "https://chat.deepseek.com",
        creds,
        requestBody: JSON.stringify({ a: 1 }),
        curlDispatchImpl: fakeCurl,
      })
      expect(result.ok).toBe(true)
      expect(captured).not.toBeNull()
      const c = captured as unknown as CurlStreamInput
      expect(c.proxyUrl).toBe("socks5h://user:pass@proxy.host:20000")
      expect(c.url).toBe("https://chat.deepseek.com/api/v0/chat/completion")
      expect(c.method).toBe("POST")
      expect(c.body).toBe(JSON.stringify({ a: 1 }))
      expect(c.headers["X-App-Version"]).toBe("20241129.1")
      expect(c.headers["Origin"]).toBe("https://chat.deepseek.com")
      expect(c.headers["Authorization"]).toBe("Bearer tok-abc")
      expect(c.headers["__proxy_url__"]).toBeUndefined()
    })
  })

  describe("#given default_headers does NOT contain __proxy_url__", () => {
    it("#when invoked #then uses Bun fetch path and bypasses curl", async () => {
      let curlCalled = false
      const fakeCurl = async () => {
        curlCalled = true
        return { ok: false as const, status: 0, bodyText: "", reason: "should not be called" }
      }
      const fakeFetch = async (url: string, init?: RequestInit) => {
        return new Response("data: {}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      }
      const creds = makeCreds({ "X-App-Version": "20241129.1" })
      const result = await dispatchStreamingCompletion({
        baseUrl: "https://chat.deepseek.com",
        creds,
        requestBody: "{}",
        fetchImpl: fakeFetch as typeof fetch,
        curlDispatchImpl: fakeCurl,
      })
      expect(result.ok).toBe(true)
      expect(curlCalled).toBe(false)
    })
  })

  describe("#given proxy curl dispatch fails", () => {
    it("#when invoked #then returns the failure verbatim", async () => {
      const fakeCurl = async () => ({
        ok: false as const,
        status: 502,
        bodyText: "bad gateway",
        reason: "upstream HTTP 502 via curl proxy",
      })
      const creds = makeCreds({ __proxy_url__: "socks5h://x:y@p:1" })
      const result = await dispatchStreamingCompletion({
        baseUrl: "https://chat.deepseek.com",
        creds,
        requestBody: "{}",
        curlDispatchImpl: fakeCurl,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(502)
        expect(result.reason).toContain("upstream HTTP 502")
      }
    })
  })
})
