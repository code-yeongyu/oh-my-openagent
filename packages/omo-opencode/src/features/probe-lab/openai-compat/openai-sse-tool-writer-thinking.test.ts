/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { SseEvent } from "./deepseek-sse-reader"
import {
  buildOpenAIToolStream,
  type ToolStreamCompletion,
} from "./openai-sse-tool-writer"
import type { ChatCompletionRequest, ToolDefinition } from "./schemas"

type ToolCallDelta = {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type Chunk = {
  choices: Array<{
    delta: {
      role?: string
      content?: string
      reasoning_content?: string
      tool_calls?: ToolCallDelta[]
    }
    finish_reason: string | null
  }>
}

function eventsFromFrames(
  frames: ReadonlyArray<unknown>,
): AsyncGenerator<SseEvent, void, void> {
  return (async function* () {
    for (const f of frames) yield { data: JSON.stringify(f) }
  })()
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const dec = new TextDecoder("utf-8")
  const reader = stream.getReader()
  let out = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  out += dec.decode()
  return out
}

function parseChunks(raw: string): Chunk[] {
  return raw
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("data: "))
    .map((s) => s.slice(6))
    .filter((s) => s !== "[DONE]")
    .map((s) => JSON.parse(s) as Chunk)
}

const TIME_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_time",
    description: "Get UTC time",
    parameters: { type: "object", properties: { tz: { type: "string" } } },
  },
}

const F_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "f",
    description: "f",
    parameters: { type: "object", properties: { x: { type: "string" } } },
  },
}

describe("buildOpenAIToolStream V0.10.1 thinking + DSML interaction", () => {
  describe("#given a THINK fragment that transitions to a RESPONSE carrying full DSML", () => {
    test("#when streamed #then reasoning_content emits first then tool_calls without leakage", async () => {
      const dsml =
        "<|DSML|tool_calls>\n" +
        '<|DSML|invoke name="get_time">\n' +
        '<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>\n' +
        "</|DSML|invoke>\n" +
        "</|DSML|tool_calls>"
      const frames = [
        { v: { response: { message_id: 200, fragments: [{ id: 1, type: "THINK", content: "我" }] } } },
        { p: "response/fragments/-1/content", o: "APPEND", v: "想" },
        { p: "response/fragments", o: "APPEND", v: [{ id: 2, type: "RESPONSE", content: "" }] },
        { p: "response/fragments/-1/content", o: "APPEND", v: dsml },
        { p: "response/status", v: "FINISHED" },
      ]
      let info: ToolStreamCompletion | null = null
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "che ore sono?" }],
        stream: true,
        tools: [TIME_TOOL],
      }
      const stream = buildOpenAIToolStream({
        events: eventsFromFrames(frames),
        body,
        responseId: "chatcmpl-think-then-tool",
        onComplete: (i) => { info = i },
      })
      const chunks = parseChunks(await readAll(stream))
      const reasoning = chunks
        .map((c) => c.choices[0]!.delta.reasoning_content)
        .filter((c): c is string => typeof c === "string")
      const toolCallChunks = chunks.flatMap(
        (c) => c.choices[0]!.delta.tool_calls ?? [],
      )
      const finalReason = chunks[chunks.length - 1]!.choices[0]!.finish_reason
      expect(reasoning.join("")).toBe("我想")
      const firstReasoningIdx = chunks.findIndex(
        (c) => typeof c.choices[0]!.delta.reasoning_content === "string",
      )
      const firstToolIdx = chunks.findIndex(
        (c) => Array.isArray(c.choices[0]!.delta.tool_calls),
      )
      expect(firstReasoningIdx).toBeGreaterThanOrEqual(0)
      expect(firstToolIdx).toBeGreaterThan(firstReasoningIdx)
      const nameChunk = toolCallChunks.find(
        (tc) => typeof tc.function?.name === "string",
      )
      expect(nameChunk?.function?.name).toBe("get_time")
      expect(typeof nameChunk?.id).toBe("string")
      expect(nameChunk?.type).toBe("function")
      const argsParts = toolCallChunks
        .map((tc) => tc.function?.arguments)
        .filter((s): s is string => typeof s === "string")
      expect(argsParts.length).toBeGreaterThanOrEqual(2)
      expect(JSON.parse(argsParts.join(""))).toEqual({ tz: "UTC" })
      expect(finalReason).toBe("tool_calls")
      for (const r of reasoning) {
        expect(r.includes("<|DSML|")).toBe(false)
      }
      expect(info!.tool_call_count).toBe(1)
      expect(info!.reasoning_chars).toBe(2)
    })
  })

  describe("#given a THINK fragment, RESPONSE transition, then bare v completing DSML", () => {
    test("#when streamed #then reasoning stays isolated and DSML is fully assembled across frames", async () => {
      const partial = '<|DSML|tool_calls>\n<|DSML|invoke name="f">\n'
      const continuation =
        '<|DSML|parameter name="x"><![CDATA[v]]></|DSML|parameter>\n' +
        "</|DSML|invoke>\n" +
        "</|DSML|tool_calls>"
      const frames = [
        { v: { response: { message_id: 201, fragments: [{ id: 1, type: "THINK", content: "thinking..." }] } } },
        { p: "response/fragments/-1/content", o: "APPEND", v: "..." },
        { p: "response/fragments", o: "APPEND", v: [{ id: 2, type: "RESPONSE", content: "" }] },
        { p: "response/fragments/-1/content", o: "APPEND", v: partial },
        { v: continuation },
        { p: "response/status", v: "FINISHED" },
      ]
      let info: ToolStreamCompletion | null = null
      const body: ChatCompletionRequest = {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "do f" }],
        stream: true,
        tools: [F_TOOL],
      }
      const stream = buildOpenAIToolStream({
        events: eventsFromFrames(frames),
        body,
        responseId: "chatcmpl-think-then-tool-buffered",
        onComplete: (i) => { info = i },
      })
      const chunks = parseChunks(await readAll(stream))
      const reasoning = chunks
        .map((c) => c.choices[0]!.delta.reasoning_content)
        .filter((c): c is string => typeof c === "string")
      const toolCallChunks = chunks.flatMap(
        (c) => c.choices[0]!.delta.tool_calls ?? [],
      )
      const finalReason = chunks[chunks.length - 1]!.choices[0]!.finish_reason
      expect(reasoning.join("")).toBe("thinking......")
      const nameChunk = toolCallChunks.find(
        (tc) => typeof tc.function?.name === "string",
      )
      expect(nameChunk?.function?.name).toBe("f")
      const argsParts = toolCallChunks
        .map((tc) => tc.function?.arguments)
        .filter((s): s is string => typeof s === "string")
      expect(argsParts.length).toBeGreaterThanOrEqual(2)
      expect(JSON.parse(argsParts.join(""))).toEqual({ x: "v" })
      expect(finalReason).toBe("tool_calls")
      expect(info!.tool_call_count).toBe(1)
    })
  })
})
