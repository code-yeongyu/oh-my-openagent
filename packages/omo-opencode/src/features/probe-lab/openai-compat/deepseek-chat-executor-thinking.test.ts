import { describe, expect, test } from "bun:test"
import { executeChatCompletion } from "./deepseek-chat-executor"
import {
  fakeFinishedSseResponseOnly,
  fakeFinishedSseThinkingOnly,
  fakeFinishedSseWithThinking,
} from "./fragment-fixtures"
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

const sessionCreateOk = (): ((req: ProbeRequest) => ProbeResponse) => () => ({
  status: 200,
  headers: {},
  body: JSON.stringify({ data: { biz_data: { id: "sess-1" } } }),
  timing: { total_ms: 5 },
  identity_used: null,
  fingerprint_used: null,
  retry_count: 0,
})

const staticResponse = (
  status: number,
  body: string,
): ((req: ProbeRequest) => ProbeResponse) => () => ({
  status,
  headers: {},
  body,
  timing: { total_ms: 50 },
  identity_used: null,
  fingerprint_used: null,
  retry_count: 0,
})

const SAMPLE_BODY: ChatCompletionRequest = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "ciao" }],
}

type AssistantMessage = {
  content: string | null
  reasoning_content?: string
}

describe("executeChatCompletion V0.10.1 thinking", () => {
  describe("#given a thinking-only SSE body", () => {
    test("#when executed #then message.reasoning_content is populated and content is empty", async () => {
      const provider = mockProvider([
        sessionCreateOk(),
        staticResponse(200, fakeFinishedSseThinkingOnly()),
      ])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: { ...SAMPLE_BODY, model: "deepseek-v4-flash", thinking: true },
        requestId: "rid-think-only",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const msg = r.response.choices[0]!.message as AssistantMessage
        expect(msg.reasoning_content).toBe("alphabeta")
        expect(msg.content).toBe("")
      }
    })
  })

  describe("#given a response-only SSE body", () => {
    test("#when executed #then message.content is populated and reasoning_content is absent", async () => {
      const provider = mockProvider([
        sessionCreateOk(),
        staticResponse(200, fakeFinishedSseResponseOnly()),
      ])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: { ...SAMPLE_BODY, model: "deepseek-v4-flash" },
        requestId: "rid-resp-only",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const msg = r.response.choices[0]!.message as AssistantMessage
        expect(msg.content).toBe("alphabeta")
        expect(msg.reasoning_content).toBeUndefined()
      }
    })
  })

  describe("#given a THINK then RESPONSE transition body", () => {
    test("#when executed #then both reasoning_content and content are populated separately", async () => {
      const provider = mockProvider([
        sessionCreateOk(),
        staticResponse(200, fakeFinishedSseWithThinking()),
      ])
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body: { ...SAMPLE_BODY, model: "deepseek-v4-flash", thinking: true, search: true },
        requestId: "rid-mix",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const msg = r.response.choices[0]!.message as AssistantMessage
        expect(msg.reasoning_content).toBe("我们被问到")
        expect(msg.content).toBe("园林里。")
      }
    })
  })
})
