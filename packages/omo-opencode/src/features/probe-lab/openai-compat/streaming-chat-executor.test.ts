import { describe, expect, test } from "bun:test"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
  ProviderCredentials,
} from "../providers/provider-types"
import type {
  StreamingDispatchInput,
  StreamingDispatchResult,
} from "./deepseek-streaming-dispatch"
import type { ChatCompletionRequest } from "./schemas"
import { executeChatCompletionStream } from "./streaming-chat-executor"

function sessionOkProvider(): ProbeProvider {
  return {
    id: "stub",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "" }),
    rotateCredentials: async () => ({ success: false, rotation_type: "" }),
    dispatchProbe: async (_req: ProbeRequest): Promise<ProbeResponse> => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: { biz_data: { id: "sess-1" } } }),
      timing: { total_ms: 5 },
      identity_used: null,
      fingerprint_used: null,
      retry_count: 0,
    }),
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

function sessionFailingProvider(): ProbeProvider {
  return {
    ...sessionOkProvider(),
    dispatchProbe: async () => ({
      status: 500,
      headers: {},
      body: "boom",
      timing: { total_ms: 5 },
      identity_used: null,
      fingerprint_used: null,
      retry_count: 0,
    }),
  }
}

const STUB_CREDS: ProviderCredentials = {
  id: "stub",
  name: "stub",
  provider_type: "deepseek_web",
  base_url: "https://chat.deepseek.com",
  auth_type: "cookie_session",
  auth_config: "{}",
  default_headers: null,
  rate_limit_rps: null,
  rate_limit_rpm: null,
  rate_limit_tpm: null,
  cooldown_on_429_s: 0,
  supported_models: null,
  health_check_url: null,
  health_check_interval_s: 0,
  status: "active",
  created_at: 0,
  updated_at: 0,
}

const SAMPLE_BODY: ChatCompletionRequest = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "ciao" }],
  stream: true,
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(s))
      controller.close()
    },
  })
}

async function readResponseBody(res: Response): Promise<string> {
  return await res.text()
}

describe("executeChatCompletionStream", () => {
  describe("#given a happy path SSE stream from upstream", () => {
    test("#when invoked #then returns text/event-stream Response with content chunks and [DONE]", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"hi"}\n\n' +
        'data: {"p":"response/content","o":"APPEND","v":" there"}\n\n' +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'

      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })

      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-stream-ok",
        dispatcher,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/)
      expect(res.headers.get("x-request-id")).toBe("rid-stream-ok")

      const body = await readResponseBody(res)
      expect(body).toContain('"role":"assistant"')
      expect(body).toContain('"content":"hi"')
      expect(body).toContain('"content":" there"')
      expect(body).toContain('"finish_reason":"stop"')
      expect(body.endsWith("data: [DONE]\n\n")).toBe(true)
    })
  })

  describe("#given dispatcher returns failure (non-200 upstream)", () => {
    test("#when invoked #then returns 502 internal_error JSON", async () => {
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: false,
        status: 500,
        bodyText: "upstream-down",
        reason: "upstream HTTP 500",
      })
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-stream-fail",
        dispatcher,
      })
      expect(res.status).toBe(502)
      const json = (await res.json()) as { error: { type: string; message: string } }
      expect(json.error.type).toBe("internal_error")
      expect(json.error.message).toMatch(/streaming dispatch failed/)
    })
  })

  describe("#given dispatcher returns 429", () => {
    test("#when invoked #then returns 429 rate_limit_error JSON", async () => {
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: false,
        status: 429,
        bodyText: "",
        reason: "upstream HTTP 429",
      })
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-stream-429",
        dispatcher,
      })
      expect(res.status).toBe(429)
      const json = (await res.json()) as { error: { type: string } }
      expect(json.error.type).toBe("rate_limit_error")
    })
  })

  describe("#given chat_session/create fails", () => {
    test("#when invoked #then returns 502 internal_error and dispatcher is not called", async () => {
      let dispatcherCalled = false
      const dispatcher = async (): Promise<StreamingDispatchResult> => {
        dispatcherCalled = true
        return {
          ok: true,
          status: 200,
          headers: {},
          body: streamFromString(""),
        }
      }
      const res = await executeChatCompletionStream({
        provider: sessionFailingProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-stream-sess-fail",
        dispatcher,
      })
      expect(res.status).toBe(502)
      expect(dispatcherCalled).toBe(false)
    })
  })

  describe("#given upstream stream truncated (no FINISHED status)", () => {
    test("#when invoked #then final chunk has finish_reason=length and [DONE] is emitted", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"partial"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-stream-trunc",
        dispatcher,
      })
      expect(res.status).toBe(200)
      const body = await readResponseBody(res)
      expect(body).toContain('"finish_reason":"length"')
      expect(body.endsWith("data: [DONE]\n\n")).toBe(true)
    })
  })

  describe("#given response.id format", () => {
    test("#when invoked #then chunk id is chatcmpl-<uuid> and is independent of requestId", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"x"}\n\n' +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-uuid-test",
        dispatcher,
      })
      const body = await readResponseBody(res)
      const idMatch = body.match(/"id":"chatcmpl-([0-9a-f-]{36})"/)
      expect(idMatch).not.toBeNull()
      expect(idMatch![1]).not.toBe("rid-uuid-test")
    })
  })

  describe("#given empty messages", () => {
    test("#when invoked #then returns 400 invalid_request_error", async () => {
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: { model: "deepseek-v4-flash", messages: [], stream: true },
        requestId: "rid-empty-msg",
        dispatcher: async (): Promise<StreamingDispatchResult> => ({
          ok: true,
          status: 200,
          headers: {},
          body: streamFromString(""),
        }),
      })
      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: { type: string } }
      expect(json.error.type).toBe("invalid_request_error")
    })
  })

  describe("#given multi-chunk SSE stream #when streamed #then ALL chunks share the EXACT SAME chatcmpl-<uuid> id (V0.6 invariant lock)", () => {
    test("multi-chunk same id regression", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"a"}\n\n' +
        'data: {"p":"response/content","o":"APPEND","v":"b"}\n\n' +
        'data: {"p":"response/content","o":"APPEND","v":"c"}\n\n' +
        'data: {"p":"response/content","o":"APPEND","v":"d"}\n\n' +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-multi-chunk",
        dispatcher,
      })
      const body = await readResponseBody(res)
      const ids = Array.from(body.matchAll(/"id":"(chatcmpl-[0-9a-f-]{36})"/g)).map(
        (m) => m[1],
      )
      expect(ids.length).toBeGreaterThanOrEqual(6)
      const unique = new Set(ids)
      expect(unique.size).toBe(1)
    })
  })

  describe("#given an abort signal #when aborted before dispatch #then upstream dispatcher receives an aborted signal", () => {
    test("pre-dispatch abort propagates", async () => {
      const ac = new AbortController()
      ac.abort()
      let receivedAborted = false
      const dispatcher = async (
        i: { signal?: AbortSignal },
      ): Promise<StreamingDispatchResult> => {
        receivedAborted = i.signal?.aborted === true
        return {
          ok: true,
          status: 200,
          headers: {},
          body: streamFromString(
            'data: {"p":"response/status","v":"FINISHED"}\n\n',
          ),
        }
      }
      await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-abort-pre",
        dispatcher,
        signal: ac.signal,
      })
      expect(receivedAborted).toBe(true)
    })
  })

  describe("#given downstream consumer cancels the response body #then upstream signal is aborted (cancel propagation)", () => {
    test("downstream cancel aborts upstream", async () => {
      let upstreamSignal: AbortSignal | null = null
      const dispatcher = async (
        i: { signal?: AbortSignal },
      ): Promise<StreamingDispatchResult> => {
        upstreamSignal = i.signal ?? null
        const enc = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              enc.encode(
                'data: {"p":"response/content","o":"APPEND","v":"x"}\n\n',
              ),
            )
            await new Promise((r) => setTimeout(r, 100))
          },
        })
        return { ok: true, status: 200, headers: {}, body }
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-down-cancel",
        dispatcher,
      })
      await res.body!.cancel("client-bye")
      await new Promise((r) => setTimeout(r, 20))
      expect(upstreamSignal).not.toBeNull()
      expect(upstreamSignal!.aborted).toBe(true)
    })
  })

  describe("#given a FINISHED stream #when completed #then session-cleanup is enqueued exactly once", () => {
    test("cleanup on FINISHED", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"hi"}\n\n' +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const calls: Array<{ chatSessionId: string }> = []
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-cleanup-finished",
        dispatcher,
        enqueueDelete: (i) => {
          calls.push({ chatSessionId: i.chatSessionId })
        },
      })
      await readResponseBody(res)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.chatSessionId).toBe("sess-1")
    })
  })

  describe("#given a truncated stream (no FINISHED) #when completed #then session-cleanup is NOT enqueued", () => {
    test("no cleanup on truncation", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"partial"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const calls: Array<{ chatSessionId: string }> = []
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-cleanup-trunc",
        dispatcher,
        enqueueDelete: (i) => {
          calls.push({ chatSessionId: i.chatSessionId })
        },
      })
      await readResponseBody(res)
      expect(calls).toHaveLength(0)
    })
  })

  describe("#given a 502 dispatch error #then session-cleanup is NOT enqueued", () => {
    test("no cleanup on dispatch error", async () => {
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: false,
        status: 500,
        bodyText: "x",
        reason: "upstream HTTP 500",
      })
      const calls: Array<{ chatSessionId: string }> = []
      await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: SAMPLE_BODY,
        requestId: "rid-cleanup-error",
        dispatcher,
        enqueueDelete: (i) => {
          calls.push({ chatSessionId: i.chatSessionId })
        },
      })
      expect(calls).toHaveLength(0)
    })
  })

  describe("#given OpenAI sampling fields in request body", () => {
    test("#when invoked #then upstream requestBody includes passthrough fields with managed fields preserved", async () => {
      let captured: string | null = null
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"hi"}\n\n' +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (
        di: StreamingDispatchInput,
      ): Promise<StreamingDispatchResult> => {
        captured = di.requestBody
        return {
          ok: true,
          status: 200,
          headers: {},
          body: streamFromString(upstreamSse),
        }
      }
      await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: {
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
          max_completion_tokens: 4096,
          temperature: 0.5,
          top_p: 0.9,
          seed: 42,
        },
        requestId: "rid-passthrough",
        dispatcher,
      })
      expect(captured).not.toBeNull()
      const parsed = JSON.parse(captured!) as Record<string, unknown>
      expect(parsed.max_completion_tokens).toBe(4096)
      expect(parsed.temperature).toBe(0.5)
      expect(parsed.top_p).toBe(0.9)
      expect(parsed.seed).toBe(42)
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
