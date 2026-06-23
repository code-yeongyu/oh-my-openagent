import { describe, expect, test } from "bun:test"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
  ProviderCredentials,
} from "../providers/provider-types"
import type { StreamingDispatchResult } from "./deepseek-streaming-dispatch"
import {
  fakeFinishedSseResponseOnly,
  fakeFinishedSseThinkingOnly,
  fakeFinishedSseWithThinking,
} from "./fragment-fixtures"
import type { ChatCompletionRequest } from "./schemas"
import { executeChatCompletionStream } from "./streaming-chat-executor"

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

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(s))
      controller.close()
    },
  })
}

function dispatcherWithBody(body: string): () => Promise<StreamingDispatchResult> {
  return async () => ({
    ok: true,
    status: 200,
    headers: {},
    body: streamFromString(body),
  })
}

describe("executeChatCompletionStream V0.10.1 thinking", () => {
  describe("#given an upstream THINK-only stream", () => {
    test("#when invoked #then response body has reasoning_content chunks and zero content chunks", async () => {
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: { ...SAMPLE_BODY, model: "deepseek-v4-flash", thinking: true },
        requestId: "rid-stream-think-only",
        dispatcher: dispatcherWithBody(fakeFinishedSseThinkingOnly()),
      })
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('"reasoning_content":"alpha"')
      expect(body).toContain('"reasoning_content":"beta"')
      expect(body).not.toContain('"content":"alpha"')
      expect(body).not.toContain('"content":"beta"')
      expect(body).toContain('"finish_reason":"stop"')
    })
  })

  describe("#given an upstream RESPONSE-only stream", () => {
    test("#when invoked #then response body has content chunks and zero reasoning_content chunks", async () => {
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: { ...SAMPLE_BODY, model: "deepseek-v4-flash" },
        requestId: "rid-stream-resp-only",
        dispatcher: dispatcherWithBody(fakeFinishedSseResponseOnly()),
      })
      const body = await res.text()
      expect(body).toContain('"content":"alpha"')
      expect(body).toContain('"content":"beta"')
      expect(body).not.toContain('"reasoning_content"')
    })
  })

  describe("#given an upstream THINK then RESPONSE transition stream", () => {
    test("#when invoked #then response body emits reasoning_content chunks before content chunks", async () => {
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body: { ...SAMPLE_BODY, model: "deepseek-v4-flash", thinking: true, search: true },
        requestId: "rid-stream-mix",
        dispatcher: dispatcherWithBody(fakeFinishedSseWithThinking()),
      })
      const body = await res.text()
      const firstReasoningIdx = body.indexOf('"reasoning_content":"我们"')
      const firstContentIdx = body.indexOf('"content":"园"')
      expect(firstReasoningIdx).toBeGreaterThanOrEqual(0)
      expect(firstContentIdx).toBeGreaterThanOrEqual(0)
      expect(firstReasoningIdx).toBeLessThan(firstContentIdx)
      expect(body).toContain('"reasoning_content":"被"')
      expect(body).toContain('"reasoning_content":"问到"')
      expect(body).toContain('"content":"林"')
      expect(body).toContain('"content":"里。"')
    })
  })
})
