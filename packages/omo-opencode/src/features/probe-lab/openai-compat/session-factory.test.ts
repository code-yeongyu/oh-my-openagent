import { describe, expect, test } from "bun:test"
import { createChatSession } from "./session-factory"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
} from "../providers/provider-types"

function mockProvider(impl: (req: ProbeRequest) => ProbeResponse): ProbeProvider {
  return {
    id: "test",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "ok", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "test" }),
    rotateCredentials: async () => ({ success: false, rotation_type: "test" }),
    dispatchProbe: async (req) => impl(req),
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

const okResponse = (body: string): ProbeResponse => ({
  status: 200,
  headers: {},
  body,
  timing: { total_ms: 5 },
  identity_used: null,
  fingerprint_used: null,
  retry_count: 0,
})

describe("createChatSession", () => {
  describe("#given provider returns 200 with biz_data.id", () => {
    test("#when called #then returns ok=true with the id", async () => {
      const provider = mockProvider(() =>
        okResponse(JSON.stringify({ data: { biz_data: { id: "session-xyz" } } })),
      )
      const r = await createChatSession({
        provider,
        baseUrl: "https://chat.deepseek.com",
        requestId: "rid-1",
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.id).toBe("session-xyz")
    })
  })

  describe("#given provider receives the URL with trailing slash on base", () => {
    test("#when called #then dispatches to the joined path without doubled slash", async () => {
      let observedUrl = ""
      const provider = mockProvider((req) => {
        observedUrl = req.url
        return okResponse(JSON.stringify({ data: { biz_data: { id: "s" } } }))
      })
      await createChatSession({
        provider,
        baseUrl: "https://chat.deepseek.com/",
        requestId: "rid",
      })
      expect(observedUrl).toBe("https://chat.deepseek.com/api/v0/chat_session/create")
    })
  })

  describe("#given provider returns HTTP 500", () => {
    test("#when called #then returns ok=false with httpStatus", async () => {
      const provider = mockProvider(() => ({
        status: 500,
        headers: {},
        body: "boom",
        timing: { total_ms: 0 },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
      }))
      const r = await createChatSession({
        provider,
        baseUrl: "https://chat.deepseek.com",
        requestId: "rid-2",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.httpStatus).toBe(500)
        expect(r.reason).toMatch(/HTTP 500/)
      }
    })
  })

  describe("#given provider returns 200 with malformed JSON", () => {
    test("#when called #then returns ok=false", async () => {
      const provider = mockProvider(() => okResponse("not json"))
      const r = await createChatSession({
        provider,
        baseUrl: "https://chat.deepseek.com",
        requestId: "rid-3",
      })
      expect(r.ok).toBe(false)
    })
  })

  describe("#given provider returns 200 with nested chat_session.id (live SPA shape May 2026)", () => {
    test("#when called #then returns ok=true with the nested id", async () => {
      const provider = mockProvider(() =>
        okResponse(
          JSON.stringify({
            data: {
              biz_code: 0,
              biz_data: {
                chat_session: { id: "nested-session-zzz", agent: "chat", model_type: "default" },
                ttl_seconds: 259200,
              },
            },
          }),
        ),
      )
      const r = await createChatSession({
        provider,
        baseUrl: "https://chat.deepseek.com",
        requestId: "rid-nested",
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.id).toBe("nested-session-zzz")
    })
  })

  describe("#given provider returns 200 without data.biz_data.id", () => {
    test("#when called #then returns ok=false", async () => {
      const provider = mockProvider(() => okResponse(JSON.stringify({ data: {} })))
      const r = await createChatSession({
        provider,
        baseUrl: "https://chat.deepseek.com",
        requestId: "rid-4",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/biz_data/)
    })
  })
})
