import { describe, expect, test } from "bun:test"
import { executeChatCompletion } from "./deepseek-chat-executor"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
} from "../providers/provider-types"
import type { ChatCompletionRequest } from "./schemas"

function mockProvider(
  scriptedResponses: ReadonlyArray<(req: ProbeRequest) => ProbeResponse>,
): ProbeProvider {
  let i = 0
  return {
    id: "mock",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "" }),
    rotateCredentials: async () => ({ success: false, rotation_type: "" }),
    dispatchProbe: async (req) => {
      const idx = Math.min(i, scriptedResponses.length - 1)
      const fn = scriptedResponses[idx]
      i++
      if (!fn) throw new Error("no scripted response")
      return fn(req)
    },
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

function sessionCreateOk(): (req: ProbeRequest) => ProbeResponse {
  return () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ data: { biz_data: { id: "sess-1" } } }),
    timing: { total_ms: 5 },
    identity_used: null,
    fingerprint_used: null,
    retry_count: 0,
  })
}

function staticResponse(
  status: number,
  body: string,
  total_ms = 50,
): (req: ProbeRequest) => ProbeResponse {
  return () => ({
    status,
    headers: {},
    body,
    timing: { total_ms },
    identity_used: null,
    fingerprint_used: null,
    retry_count: 0,
  })
}

const SAMPLE_BODY: ChatCompletionRequest = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "ciao" }],
}

describe("executeChatCompletion", () => {
  describe("#given a successful FINISHED SSE", () => {
    test("#when executed #then returns OpenAI-shaped response with concatenated content", async () => {
      const sse = [
        `data: {"v":"hello","p":"response/content"}`,
        `data: {"v":" world","p":"response/content"}`,
        `data: {"v":"FINISHED","p":"response/status"}`,
      ].join("\n")
      const provider = mockProvider([sessionCreateOk(), staticResponse(200, sse, 100)])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-x",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/)
        expect(r.response.model).toBe("deepseek-v4-flash")
        expect(r.response.choices[0]!.message.content).toBe("hello world")
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.role).toBe("assistant")
      }
    })
  })

  describe("#given empty SSE (HTTP 200, no events)", () => {
    test("#when executed #then returns empty_sse error", async () => {
      const provider = mockProvider([sessionCreateOk(), staticResponse(200, "")])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-empty",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("empty_sse")
        expect(r.httpStatus).toBe(502)
      }
    })
  })

  describe("#given truncated SSE (events without FINISHED status)", () => {
    test("#when executed #then returns truncated_stream error", async () => {
      const sse = `data: {"v":"partial","p":"response/content"}`
      const provider = mockProvider([sessionCreateOk(), staticResponse(200, sse, 700)])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-trunc",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errorType).toBe("truncated_stream")
    })
  })

  describe("#given MISSING_HEADER body (biz_code 40300)", () => {
    test("#when executed #then returns internal_error mentioning MISSING_HEADER", async () => {
      const body = JSON.stringify({ biz_code: 40300, msg: "MISSING_HEADER" })
      const provider = mockProvider([sessionCreateOk(), staticResponse(200, body)])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-mh",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/MISSING_HEADER/)
      }
    })
  })

  describe("#given HTTP 500 from DeepSeek", () => {
    test("#when executed #then returns internal_error with HTTP-status message", async () => {
      const provider = mockProvider([sessionCreateOk(), staticResponse(500, "boom", 10)])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-500",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/HTTP 500/)
      }
    })
  })

  describe("#given session_create returns HTTP 500", () => {
    test("#when executed #then returns internal_error before completion is called", async () => {
      const provider = mockProvider([staticResponse(500, "session-boom")])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-sess",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/chat_session/)
      }
    })
  })

  describe("#given empty messages array", () => {
    test("#when executed #then returns 400 invalid_request_error", async () => {
      const provider = mockProvider([sessionCreateOk()])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: { model: "deepseek-v4-flash", messages: [] },
        requestId: "rid-bad",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.httpStatus).toBe(400)
        expect(r.errorType).toBe("invalid_request_error")
      }
    })
  })

  describe("#given a tool message in messages", () => {
    test("#when executed #then returns 400 invalid_request_error", async () => {
      const provider = mockProvider([sessionCreateOk()])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: {
          model: "deepseek-v4-flash",
          messages: [
            { role: "user", content: "x" },
            { role: "tool", content: "y" },
          ],
        },
        requestId: "rid-tool",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errorType).toBe("invalid_request_error")
    })
  })

  describe("#given HTTP 401 auth failure", () => {
    test("#when executed #then returns internal_error mentioning auth", async () => {
      const provider = mockProvider([
        sessionCreateOk(),
        staticResponse(401, "unauthorized"),
      ])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-401",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/auth/i)
      }
    })
  })

  describe("#given a hung dispatchProbe #when bounded by dispatchTimeoutMs #then returns 502 within the bound", () => {
    test("V0.5 timeout race", async () => {
      const provider: ProbeProvider = {
        id: "hung",
        kind: "deepseek_web",
        healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
        refreshCredentials: async () => ({ success: true, refresh_type: "" }),
        rotateCredentials: async () => ({ success: false, rotation_type: "" }),
        dispatchProbe: async () => {
          await new Promise((r) => setTimeout(r, 10_000))
          throw new Error("should not reach")
        },
        getRateLimits: () => ({
          rps: null,
          rpm: null,
          tpm: null,
          cooldown_on_429_s: 0,
        }),
        getErrorTaxonomy: () => ({
          rate_limited_signals: [],
          blocked_signals: [],
        }),
        getSupportedModels: () => [],
      }
      const sessProvider = mockProvider([sessionCreateOk()])
      const composite: ProbeProvider = {
        ...provider,
        dispatchProbe: (req) => {
          if (req.url.includes("/chat_session/create")) {
            return sessProvider.dispatchProbe(req)
          }
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error("never")), 10_000),
          )
        },
      }
      const t0 = Date.now()
      const r = await executeChatCompletion({
        provider: composite,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-timeout",
        dispatchTimeoutMs: 60,
      })
      const elapsed = Date.now() - t0
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.httpStatus).toBe(502)
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/timeout/i)
      }
      expect(elapsed).toBeLessThan(2_000)
    })
  })

  describe("#given dispatchProbe throws ECONNRESET #when invoked #then returns 502 internal_error", () => {
    test("V0.5 ECONNRESET classification", async () => {
      const sessProvider = mockProvider([sessionCreateOk()])
      const provider: ProbeProvider = {
        ...sessProvider,
        dispatchProbe: (req) => {
          if (req.url.includes("/chat_session/create")) {
            return sessProvider.dispatchProbe(req)
          }
          return Promise.reject(new Error("fetch failed: ECONNRESET"))
        },
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-econnreset",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/ECONNRESET/)
      }
    })
  })

  describe("#given a non-FINISHED terminal status (e.g. ERROR)", () => {
    test("#when executed #then returns internal_error", async () => {
      const sse = [
        `data: {"v":"some","p":"response/content"}`,
        `data: {"v":"ERROR","p":"response/status"}`,
      ].join("\n")
      const provider = mockProvider([sessionCreateOk(), staticResponse(200, sse)])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: SAMPLE_BODY,
        requestId: "rid-err-status",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorType).toBe("internal_error")
        expect(r.message).toMatch(/ERROR/)
      }
    })
  })

  describe("#given OpenAI sampling fields in request body", () => {
    test("#when executed #then upstream probe body includes passthrough fields with managed fields preserved", async () => {
      const sse = [
        `data: {"v":"ok","p":"response/content"}`,
        `data: {"v":"FINISHED","p":"response/status"}`,
      ].join("\n")
      let capturedBody: string | undefined
      const provider: ProbeProvider = {
        id: "mock",
        kind: "deepseek_web",
        healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
        refreshCredentials: async () => ({ success: true, refresh_type: "" }),
        rotateCredentials: async () => ({ success: false, rotation_type: "" }),
        dispatchProbe: async (req) => {
          if (req.url.includes("/chat/completion")) {
            capturedBody = typeof req.body === "string" ? req.body : undefined
            return staticResponse(200, sse)(req)
          }
          if (req.url.includes("/chat_session/create")) {
            return sessionCreateOk()(req)
          }
          return staticResponse(200, "")(req)
        },
        getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
        getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
        getSupportedModels: () => [],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: {
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "hi" }],
          max_completion_tokens: 4096,
          temperature: 0.5,
          top_p: 0.9,
          seed: 42,
          stop: ["###"],
        },
        requestId: "rid-passthrough-nonstream",
      })
      expect(r.ok).toBe(true)
      expect(capturedBody).toBeDefined()
      const parsed = JSON.parse(capturedBody!) as Record<string, unknown>
      expect(parsed.max_completion_tokens).toBe(4096)
      expect(parsed.temperature).toBe(0.5)
      expect(parsed.top_p).toBe(0.9)
      expect(parsed.seed).toBe(42)
      expect(parsed.stop).toEqual(["###"])
      expect(parsed.chat_session_id).toBe("sess-1")
      expect(parsed.thinking_enabled).toBe(true)
      expect(parsed.search_enabled).toBe(false)
      expect(parsed.model_type).toBe("expert")
      expect(parsed.prompt).toBeDefined()
      expect(parsed.model).toBeUndefined()
      expect(parsed.messages).toBeUndefined()
    })
  })

})
