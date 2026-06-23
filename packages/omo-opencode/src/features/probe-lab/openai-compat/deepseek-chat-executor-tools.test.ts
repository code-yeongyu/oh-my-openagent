/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { executeChatCompletion } from "./deepseek-chat-executor"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
} from "../providers/provider-types"
import type { ChatCompletionRequest, ToolDefinition } from "./schemas"
import { createTelemetry } from "./telemetry"

function recordingProvider(
  scriptedResponses: ReadonlyArray<(req: ProbeRequest) => ProbeResponse>,
  capturedRequests: ProbeRequest[],
): ProbeProvider {
  let i = 0
  return {
    id: "mock",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "" }),
    rotateCredentials: async () => ({ success: false, rotation_type: "" }),
    dispatchProbe: async (req) => {
      capturedRequests.push(req)
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

function sseFinishedWith(
  content: string,
  responseMessageId?: number,
): (req: ProbeRequest) => ProbeResponse {
  return () => {
    const body = [
      ...(responseMessageId === undefined
        ? []
        : [
            "event: ready",
            `data: {"request_message_id":1,"response_message_id":${responseMessageId},"model_type":"default"}`,
            `data: {"v":{"response":{"message_id":${responseMessageId},"status":"WIP"}}}`,
          ]),
      `data: {"v":${JSON.stringify(content)},"p":"response/content"}`,
      `data: {"v":"FINISHED","p":"response/status"}`,
    ].join("\n")
    return {
      status: 200,
      headers: {},
      body,
      timing: { total_ms: 100 },
      identity_used: null,
      fingerprint_used: null,
      retry_count: 0,
    }
  }
}

const TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get current UTC time",
    parameters: { type: "object", properties: {} },
  },
}

describe("executeChatCompletion + tools (V0.9.1)", () => {
  describe("#given a request with tools and a model that emits DSML", () => {
    test("#when executed #then returns tool_calls response with finish_reason 'tool_calls'", async () => {
      const dsml = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(dsml)],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-tool-1",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("tool_calls")
        expect(r.response.choices[0]!.message.content).toBeNull()
        const calls = r.response.choices[0]!.message.tool_calls!
        expect(calls.length).toBe(1)
        expect(calls[0]!.function.name).toBe("get_current_time")
        expect(calls[0]!.id).toMatch(/^call_[0-9a-f]{16}$/)
      }
    })
  })

  describe("#given a request with tools but model output has no DSML block", () => {
    test("#when executed #then returns standard response with finish_reason 'stop'", async () => {
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("Sono le 14:00")],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-tool-2",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.content).toBe("Sono le 14:00")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
      }
      expect(captured.filter((c) => c.url.includes("/chat/completion"))).toHaveLength(1)
    })
  })

  describe("#given a request without tools", () => {
    test("#when executed #then existing flow unchanged (no DSML injection in prompt)", async () => {
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("hello")],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "ciao" }],
      }
      await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-no-tools",
      })
      const completionReq = captured.find((c) =>
        c.url.includes("/chat/completion"),
      )
      expect(completionReq).toBeDefined()
      const reqBody = JSON.parse(completionReq!.body!) as { prompt: string }
      expect(reqBody.prompt).not.toContain("<|DSML|tool_calls>")
      expect(reqBody.prompt).toContain("[user]: ciao")
      expect(captured.filter((c) => c.url.includes("/chat/completion"))).toHaveLength(1)
    })
  })

  describe("#given a request with tool_choice 'none'", () => {
    test("#when executed #then no DSML prefix injected and DSML in output not parsed as tool_calls", async () => {
      const captured: ProbeRequest[] = []
      const dsml = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(dsml)],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
        tool_choice: "none",
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-tool-none",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
      }
      const completionReq = captured.find((c) =>
        c.url.includes("/chat/completion"),
      )
      const reqBody = JSON.parse(completionReq!.body!) as { prompt: string }
      expect(reqBody.prompt).not.toContain("<|DSML|tool_calls>")
      expect(captured.filter((c) => c.url.includes("/chat/completion"))).toHaveLength(1)
    })
  })

  describe("#given tools active in body", () => {
    test("#when executed #then upstream prompt contains DSML instruction prefix", async () => {
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("ok")],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-tool-prefix",
      })
      const completionReq = captured.find((c) =>
        c.url.includes("/chat/completion"),
      )
      const reqBody = JSON.parse(completionReq!.body!) as { prompt: string }
      expect(reqBody.prompt).toContain("Available tools:")
      expect(reqBody.prompt).toContain("get_current_time")
      expect(reqBody.prompt).toContain("[user]: x")
    })
  })
})

const TOOL_SEARCH: ToolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
}

describe("executeChatCompletion + tool_choice policy (V0.9.2)", () => {
  describe("#given tool_choice {type:'function', name:'get_current_time'} and DSML output containing two calls", () => {
    test("#when executed #then non-matching call is filtered out and only the targeted tool is returned", async () => {
      const dsml = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="search_web">
<|DSML|parameter name="query"><![CDATA[bun]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(dsml)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL, TOOL_SEARCH],
        tool_choice: { type: "function", function: { name: "get_current_time" } },
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-tc-specific",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const calls = r.response.choices[0]!.message.tool_calls!
        expect(calls.length).toBe(1)
        expect(calls[0]!.function.name).toBe("get_current_time")
      }
    })
  })

  describe("#given tool_choice 'required' and model emits NO DSML tool_calls", () => {
    test("#when executed #then returns 502 with error_type tool_required_but_not_called", async () => {
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("just plain prose, no tool block")],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
        tool_choice: "required",
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-required-nocalls",
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.httpStatus).toBe(502)
        expect(r.errorType).toBe("upstream_contract_violation")
        expect(r.message).toMatch(/tool_required_but_not_called/i)
      }
    })
  })

  describe("#given parallel_tool_calls:false and DSML output containing 2 calls", () => {
    test("#when executed #then only the first call survives and dropped count reflected", async () => {
      const dsml = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="search_web">
<|DSML|parameter name="query"><![CDATA[bun]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(dsml)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL, TOOL_SEARCH],
        parallel_tool_calls: false,
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-parallel-false",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const calls = r.response.choices[0]!.message.tool_calls!
        expect(calls.length).toBe(1)
        expect(calls[0]!.function.name).toBe("get_current_time")
      }
    })
  })

  describe("#given parallel_tool_calls disabled in body", () => {
    test("#when prompt is built #then it includes the call-at-most-one steering line", async () => {
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("ok")],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
        parallel_tool_calls: false,
      }
      await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-parallel-prompt",
      })
      const completionReq = captured.find((c) =>
        c.url.includes("/chat/completion"),
      )
      const reqBody = JSON.parse(completionReq!.body!) as { prompt: string }
      expect(reqBody.prompt.toLowerCase()).toContain("at most one")
    })
  })

  describe("#given tool_calls detected and the model leaks prose alongside DSML (V0.9.1 cheap fix)", () => {
    test("#when executed #then returned content is null regardless of leaked text", async () => {
      const dsmlWithLeak = `Sure, calling now: <|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(dsmlWithLeak)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-leak",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.message.content).toBeNull()
      }
    })
  })

  describe("#given a multi-turn message history (assistant tool_call + tool result)", () => {
    test("#when executed #then upstream prompt embeds DSML history blocks (tool_calls + tool_results)", async () => {
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("Sono le 17:00 UTC")],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [
          { role: "user", content: "Che ore sono?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_t1",
                type: "function",
                function: {
                  name: "get_current_time",
                  arguments: JSON.stringify({ tz: "UTC" }),
                },
              },
            ],
          } as never,
          {
            role: "tool",
            content: '{"time":"17:00 UTC"}',
            tool_call_id: "call_t1",
            name: "get_current_time",
          } as never,
        ],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-multiturn",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.content).toBe("Sono le 17:00 UTC")
      }
      const completionReq = captured.find((c) =>
        c.url.includes("/chat/completion"),
      )
      const reqBody = JSON.parse(completionReq!.body!) as { prompt: string }
      expect(reqBody.prompt).toContain("<|DSML|tool_calls>")
      expect(reqBody.prompt).toContain("<|DSML|tool_results>")
      expect(reqBody.prompt).toContain("call_t1")
    })
  })
})

describe("executeChatCompletion + V0.9.4 empty-output retry and DSML cleanup", () => {
  describe("#given DSML prose leak with only empty invokes", () => {
    test("#when executed #then DSML is stripped and tool_calls stay absent", async () => {
      const leaked = `Sure, calling now: <|DSML|tool_calls>
<|DSML|invoke name="get_current_time"></|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(leaked, 2)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-v094-prose-leak",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
        expect(r.response.choices[0]!.message.content).toBe("Sure, calling now:")
      }
    })
  })

  describe("#given tools active and the first attempt is empty", () => {
    test("#when executed #then it retries once with the same session and parent_message_id", async () => {
      const captured: ProbeRequest[] = []
      const provider = recordingProvider(
        [
          sessionCreateOk(),
          sseFinishedWith("", 2),
          sseFinishedWith("Sono le 14:00", 3),
        ],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-v094-retry",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.content).toBe("Sono le 14:00")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
      }
      const completionRequests = captured.filter((c) =>
        c.url.includes("/chat/completion"),
      )
      expect(completionRequests).toHaveLength(2)
      const firstBody = JSON.parse(completionRequests[0]!.body!) as {
        chat_session_id: string
        parent_message_id: number | null
        prompt: string
      }
      const secondBody = JSON.parse(completionRequests[1]!.body!) as {
        chat_session_id: string
        parent_message_id: number | null
        prompt: string
      }
      expect(firstBody.chat_session_id).toBe(secondBody.chat_session_id)
      expect(firstBody.prompt).toBe(secondBody.prompt)
      expect(firstBody.parent_message_id).toBeNull()
      expect(secondBody.parent_message_id).toBe(2)
    })
  })

  describe("#given tools active and both attempts are empty", () => {
    test("#when executed #then empty content is returned and telemetry records empty_output_after_retry", async () => {
      const captured: ProbeRequest[] = []
      const telemetry = createTelemetry()
      const provider = recordingProvider(
        [
          sessionCreateOk(),
          sseFinishedWith("", 2),
          sseFinishedWith("", 3),
        ],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-v094-double-empty",
        telemetry,
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.content).toBe("")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
      }
      const completionRequests = captured.filter((c) =>
        c.url.includes("/chat/completion"),
      )
      expect(completionRequests).toHaveLength(2)
      const snapshot = telemetry.snapshot()
      expect(snapshot.per_account).toHaveLength(1)
      const account = snapshot.per_account[0]!
      expect(account.counters.empty_output_after_retry).toBe(1)
      expect(account.counters.success).toBe(0)
    })
  })
})

describe("executeChatCompletion + V0.9.3 noise tolerance + V4-Pro leak", () => {
  describe("#given DSML with missing-pipe noise wrapper <|DSML tool_calls>", () => {
    test("#when executed #then noise-wrapped DSML still parsed as tool_calls", async () => {
      const noisy = `<|DSML tool_calls>
<|DSML invoke name="get_current_time">
<|DSML parameter name="tz"><![CDATA[UTC]]></|DSML parameter>
</|DSML invoke>
</|DSML tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(noisy)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-noise-pipe",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("tool_calls")
        expect(r.response.choices[0]!.message.tool_calls?.[0]?.function.name).toBe(
          "get_current_time",
        )
      }
    })
  })

  describe("#given DSML with concatenated noise wrapper <|DSMLtool_calls>", () => {
    test("#when executed #then concatenated DSML still parsed", async () => {
      const noisy = `<|DSMLtool_calls>
<|DSMLinvoke name="get_current_time">
<|DSMLparameter name="tz">UTC</|DSMLparameter>
</|DSMLinvoke>
</|DSMLtool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(noisy)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-noise-concat",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("tool_calls")
      }
    })
  })

  describe("#given DSML inside fenced ``` block alongside genuine prose", () => {
    test("#when executed #then NO tool_calls parsed (fence excluded), content returned as-is", async () => {
      const fenced =
        "Sure! Here's how the tool call would look:\n```\n<|DSML|tool_calls>\n<|DSML|invoke name=\"get_current_time\"></|DSML|invoke>\n</|DSML|tool_calls>\n```\nBut I'll just answer directly: it's 14:00."
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(fenced)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-fenced-prose",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
        expect(r.response.choices[0]!.message.content).toContain("14:00")
      }
    })
  })

  describe("#given V4-Pro bug (DSML in content with finish_reason stop equivalent)", () => {
    test("#when primary parser misses but leak-reparser recovers #then tool_calls emitted with cleaned content", async () => {
      const v4ProLeak = `Calling now: <|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(v4ProLeak)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-v4pro",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("tool_calls")
        const tc = r.response.choices[0]!.message.tool_calls!
        expect(tc.length).toBe(1)
        expect(tc[0]!.function.name).toBe("get_current_time")
      }
    })
  })

  describe("#given parameter with split CDATA escape (]]> bridge)", () => {
    test("#when executed #then split CDATA reassembled into single argument value", async () => {
      const dsml = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[before]]]]><![CDATA[>after]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith(dsml)],
        [],
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-split-cdata",
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const args = JSON.parse(
          r.response.choices[0]!.message.tool_calls![0]!.function.arguments,
        ) as { tz: string }
        expect(args.tz).toBe("before]]>after")
      }
    })
  })
})

describe("executeChatCompletion + V0.9.5 prep: empty-output retry guard for missing response_message_id", () => {
  describe("#given tools active and the first attempt is empty AND the SSE has NO ready event (no response_message_id)", () => {
    test("#when executed #then retry is SKIPPED and empty content returned (no silent retry with parent_message_id null)", async () => {
      const captured: ProbeRequest[] = []
      const telemetry = createTelemetry()
      const provider = recordingProvider(
        [sessionCreateOk(), sseFinishedWith("")],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Che ore sono?" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-v095-no-msgid",
        telemetry,
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.content).toBe("")
        expect(r.response.choices[0]!.message.tool_calls).toBeUndefined()
      }
      const completionRequests = captured.filter((c) =>
        c.url.includes("/chat/completion"),
      )
      expect(completionRequests).toHaveLength(1)
      const snapshot = telemetry.snapshot()
      const account = snapshot.per_account[0]!
      expect(account.counters.empty_output_after_retry).toBe(1)
    })
  })

  describe("#given tools active and a malformed ready event (response_message_id missing field)", () => {
    test("#when first attempt is empty #then retry is SKIPPED (responseMessageId still null)", async () => {
      const captured: ProbeRequest[] = []
      const telemetry = createTelemetry()
      const malformedReadyOnly: (req: ProbeRequest) => ProbeResponse = () => {
        const body = [
          "event: ready",
          `data: {"request_message_id":1,"model_type":"default"}`,
          `data: {"v":"FINISHED","p":"response/status"}`,
        ].join("\n")
        return {
          status: 200,
          headers: {},
          body,
          timing: { total_ms: 10 },
          identity_used: null,
          fingerprint_used: null,
          retry_count: 0,
        }
      }
      const provider = recordingProvider(
        [sessionCreateOk(), malformedReadyOnly],
        captured,
      )
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
        tools: [TOOL],
      }
      const r = await executeChatCompletion({
        provider,
        baseUrl: "https://chat.deepseek.com",
        body,
        requestId: "rid-v095-malformed-ready",
        telemetry,
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.response.choices[0]!.finish_reason).toBe("stop")
        expect(r.response.choices[0]!.message.content).toBe("")
      }
      const completionRequests = captured.filter((c) =>
        c.url.includes("/chat/completion"),
      )
      expect(completionRequests).toHaveLength(1)
      const snapshot = telemetry.snapshot()
      const account = snapshot.per_account[0]!
      expect(account.counters.empty_output_after_retry).toBe(1)
    })
  })
})
