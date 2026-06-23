/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
  ProviderCredentials,
} from "../providers/provider-types"
import type { StreamingDispatchResult } from "./deepseek-streaming-dispatch"
import type { ChatCompletionRequest, ToolDefinition } from "./schemas"
import { executeChatCompletionStream } from "./streaming-chat-executor"

function sessionOkProvider(captured?: ProbeRequest[]): ProbeProvider {
  return {
    id: "stub",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "" }),
    rotateCredentials: async () => ({ success: false, rotation_type: "" }),
    dispatchProbe: async (req: ProbeRequest): Promise<ProbeResponse> => {
      if (captured) captured.push(req)
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ data: { biz_data: { id: "sess-1" } } }),
        timing: { total_ms: 5 },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
      }
    },
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
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

const TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get UTC time",
    parameters: { type: "object", properties: {} },
  },
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

function chunkedStream(chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i]!))
        i++
      } else {
        controller.close()
      }
    },
  })
}

async function readBody(res: Response): Promise<string> {
  return await res.text()
}

describe("executeChatCompletionStream + tools (V0.9.5)", () => {
  describe("#given stream:true + tools active and DSML-emitting upstream", () => {
    test("#when streamed #then SSE chunks include delta.tool_calls, all share same id, finish_reason 'tool_calls', [DONE]", async () => {
      const dsml = `<|DSML|tool_calls>\n<|DSML|invoke name=\"get_current_time\">\n<|DSML|parameter name=\"tz\"><![CDATA[UTC]]></|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>`
      const upstreamSse =
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: dsml })}\n\n` +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "che ore sono?" }],
        stream: true,
        tools: [TOOL],
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-stream-tool",
        dispatcher,
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/)
      const text = await readBody(res)
      expect(text).toContain('"role":"assistant"')
      expect(text).toMatch(/"tool_calls":\[/)
      expect(text).toContain('"name":"get_current_time"')
      expect(text).toContain('"finish_reason":"tool_calls"')
      expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
      const argsParts = Array.from(
        text.matchAll(/"arguments":"((?:[^"\\]|\\.)*)"/g),
      ).map((m) => JSON.parse(`"${m[1]}"`) as string)
      expect(argsParts.length).toBeGreaterThanOrEqual(2)
      expect(JSON.parse(argsParts.join(""))).toEqual({ tz: "UTC" })
      const nameIdx = text.search(/"name":"get_current_time"/)
      const firstArgsIdx = text.search(/"arguments":/)
      const finishIdx = text.search(/"finish_reason":"tool_calls"/)
      expect(nameIdx).toBeGreaterThan(0)
      expect(firstArgsIdx).toBeGreaterThan(nameIdx)
      expect(finishIdx).toBeGreaterThan(firstArgsIdx)
      const ids = Array.from(text.matchAll(/"id":"(chatcmpl-[0-9a-f-]{36})"/g)).map((m) => m[1])
      expect(ids.length).toBeGreaterThanOrEqual(3)
      const unique = new Set(ids)
      expect(unique.size).toBe(1)
    })
  })

  describe("#given stream:true + tools active and DSML chunked across SSE events", () => {
    test("#when streamed #then DSML markup never leaks to delta.content", async () => {
      const upstreamSse =
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: "<|DS" })}\n\n` +
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: "ML|tool_calls>\n<|DSML|invoke name=\"get_current_time\">" })}\n\n` +
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: "\n<|DSML|parameter name=\"tz\"><![CDATA[UTC]]></|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>" })}\n\n` +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        stream: true,
        tools: [TOOL],
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-stream-chunked",
        dispatcher,
      })
      const text = await readBody(res)
      expect(text).not.toContain("<|DSML|")
      expect(text).toContain('"finish_reason":"tool_calls"')
    })
  })

  describe("#given stream:true + tools active and fenced-code containing DSML in upstream prose", () => {
    test("#when streamed #then DSML inside fence is preserved as content (no false-positive tool_call)", async () => {
      const fenced = "Here is an example:\n```\n<|DSML|tool_calls>\n<|DSML|invoke name=\"x\"></|DSML|invoke>\n</|DSML|tool_calls>\n```\nThe answer is 14:00."
      const upstreamSse =
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: fenced })}\n\n` +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        stream: true,
        tools: [TOOL],
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-fenced-prose",
        dispatcher,
      })
      const text = await readBody(res)
      expect(text).not.toMatch(/"tool_calls":\[/)
      expect(text).toContain('"finish_reason":"stop"')
      expect(text).toContain("```")
    })
  })

  describe("#given stream:true + tools active + parallel_tool_calls:false and DSML with 2 invokes", () => {
    test("#when streamed #then only the FIRST tool_call is emitted", async () => {
      const dsml = `<|DSML|tool_calls>\n<|DSML|invoke name=\"get_current_time\">\n<|DSML|parameter name=\"tz\"><![CDATA[UTC]]></|DSML|parameter>\n</|DSML|invoke>\n<|DSML|invoke name=\"search_web\">\n<|DSML|parameter name=\"query\"><![CDATA[bun]]></|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>`
      const upstreamSse =
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: dsml })}\n\n` +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        stream: true,
        tools: [
          TOOL,
          { type: "function", function: { name: "search_web", parameters: { type: "object", properties: { query: { type: "string" } } } } },
        ],
        parallel_tool_calls: false,
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-parallel-false",
        dispatcher,
      })
      const text = await readBody(res)
      expect(text).toContain('"name":"get_current_time"')
      expect(text).not.toContain('"name":"search_web"')
    })
  })

  describe("#given stream:true + tools active and upstream prompt building", () => {
    test("#when dispatched #then upstream prompt has DSML instruction prefix", async () => {
      const captured: ProbeRequest[] = []
      let dispatchedBody = ""
      const upstreamSse = 'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (i: { requestBody: string }): Promise<StreamingDispatchResult> => {
        dispatchedBody = i.requestBody
        return { ok: true, status: 200, headers: {}, body: streamFromString(upstreamSse) }
      }
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        stream: true,
        tools: [TOOL],
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(captured),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-prompt-prefix",
        dispatcher,
      })
      await readBody(res)
      const parsed = JSON.parse(dispatchedBody) as { prompt: string }
      expect(parsed.prompt).toContain("Available tools:")
      expect(parsed.prompt).toContain("get_current_time")
    })
  })

  describe("#given stream:true with NO tools (V0.6 regression)", () => {
    test("#when streamed #then content streaming unchanged (delta.content path active, no tool_calls)", async () => {
      const upstreamSse =
        'data: {"p":"response/content","o":"APPEND","v":"hello"}\n\n' +
        'data: {"p":"response/content","o":"APPEND","v":" world"}\n\n' +
        'data: {"p":"response/status","v":"FINISHED"}\n\n'
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: streamFromString(upstreamSse),
      })
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "ciao" }],
        stream: true,
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-no-tools",
        dispatcher,
      })
      const text = await readBody(res)
      expect(text).toContain('"content":"hello"')
      expect(text).toContain('"content":" world"')
      expect(text).not.toMatch(/"tool_calls":\[/)
      expect(text).toContain('"finish_reason":"stop"')
    })
  })

  describe("#given stream:true + tools active + chunked SSE arrival simulating real network", () => {
    test("#when streamed #then sieve handles boundary across multiple SSE deliveries", async () => {
      const upstreamChunks = [
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: "Calling: " })}\n\n`,
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: "<|DS" })}\n\n`,
        `data: ${JSON.stringify({ p: "response/content", o: "APPEND", v: "ML|tool_calls>\n<|DSML|invoke name=\"get_current_time\"><|DSML|parameter name=\"tz\"><![CDATA[UTC]]></|DSML|parameter></|DSML|invoke></|DSML|tool_calls>" })}\n\n`,
        'data: {"p":"response/status","v":"FINISHED"}\n\n',
      ]
      const dispatcher = async (): Promise<StreamingDispatchResult> => ({
        ok: true,
        status: 200,
        headers: {},
        body: chunkedStream(upstreamChunks),
      })
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        stream: true,
        tools: [TOOL],
      }
      const res = await executeChatCompletionStream({
        provider: sessionOkProvider(),
        baseUrl: "https://chat.deepseek.com",
        creds: STUB_CREDS,
        body,
        requestId: "rid-v095-network-chunks",
        dispatcher,
      })
      const text = await readBody(res)
      expect(text).toContain('"content":"Calling: "')
      expect(text).not.toContain("<|DS")
      expect(text).toContain('"name":"get_current_time"')
      expect(text).toContain('"finish_reason":"tool_calls"')
    })
  })
})
