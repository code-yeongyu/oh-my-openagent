import { describe, expect, test } from "bun:test"
import type { SseEvent } from "./deepseek-sse-reader"
import {
  fakeFinishedSseResponseOnly,
  fakeFinishedSseThinkingOnly,
  fakeFinishedSseWithThinking,
} from "./fragment-fixtures"
import {
  buildOpenAIStream,
  type OpenAIStreamCompletion,
} from "./openai-sse-writer"

type Chunk = {
  choices: Array<{
    delta: { role?: string; content?: string; reasoning_content?: string }
    finish_reason: string | null
  }>
}

function eventsFromBody(body: string): AsyncGenerator<SseEvent, void, void> {
  const datas = body
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("data: "))
    .map((s) => s.slice(6))
  return (async function* () {
    for (const d of datas) yield { data: d }
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

describe("buildOpenAIStream V0.10.1 thinking", () => {
  describe("#given a thinking-only fragment stream", () => {
    test("#when streamed #then emits reasoning_content chunks and zero content chunks", async () => {
      let info: OpenAIStreamCompletion | null = null
      const stream = buildOpenAIStream({
        events: eventsFromBody(fakeFinishedSseThinkingOnly()),
        model: "deepseek-v4-flash",
        responseId: "chatcmpl-think",
        onComplete: (i) => { info = i },
      })
      const chunks = parseChunks(await readAll(stream))
      const reasoning = chunks.map((c) => c.choices[0]!.delta.reasoning_content).filter((c): c is string => typeof c === "string")
      const content = chunks.map((c) => c.choices[0]!.delta.content).filter((c): c is string => typeof c === "string")
      expect(reasoning.join("")).toBe("alphabeta")
      expect(content).toEqual([])
      expect(info!.reasoning_chars).toBe(9)
      expect(info!.content_chars).toBe(0)
      expect(info!.finish_reason).toBe("stop")
    })
  })

  describe("#given a response-only fragment stream", () => {
    test("#when streamed #then emits content chunks and zero reasoning chunks", async () => {
      let info: OpenAIStreamCompletion | null = null
      const stream = buildOpenAIStream({
        events: eventsFromBody(fakeFinishedSseResponseOnly()),
        model: "deepseek-v4-flash",
        responseId: "chatcmpl-resp-only",
        onComplete: (i) => { info = i },
      })
      const chunks = parseChunks(await readAll(stream))
      const content = chunks.map((c) => c.choices[0]!.delta.content).filter((c): c is string => typeof c === "string")
      const reasoning = chunks.map((c) => c.choices[0]!.delta.reasoning_content).filter((c): c is string => typeof c === "string")
      expect(content.join("")).toBe("alphabeta")
      expect(reasoning).toEqual([])
      expect(info!.reasoning_chars).toBe(0)
      expect(info!.content_chars).toBe(9)
    })
  })

  describe("#given a THINK then RESPONSE transition stream", () => {
    test("#when streamed #then reasoning chunks precede content chunks and the two are mutually exclusive per chunk", async () => {
      let info: OpenAIStreamCompletion | null = null
      const stream = buildOpenAIStream({
        events: eventsFromBody(fakeFinishedSseWithThinking()),
        model: "deepseek-v4-flash",
        responseId: "chatcmpl-mix",
        onComplete: (i) => { info = i },
      })
      const chunks = parseChunks(await readAll(stream))
      for (const c of chunks) {
        const d = c.choices[0]!.delta
        if (typeof d.content === "string" && typeof d.reasoning_content === "string") {
          throw new Error("chunk had both content and reasoning_content")
        }
      }
      const reasoning = chunks.map((c) => c.choices[0]!.delta.reasoning_content).filter((c): c is string => typeof c === "string")
      const content = chunks.map((c) => c.choices[0]!.delta.content).filter((c): c is string => typeof c === "string")
      expect(reasoning.join("")).toBe("我们被问到")
      expect(content.join("")).toBe("园林里。")
      const firstReasoningIdx = chunks.findIndex((c) => typeof c.choices[0]!.delta.reasoning_content === "string")
      const firstContentIdx = chunks.findIndex((c) => typeof c.choices[0]!.delta.content === "string")
      expect(firstReasoningIdx).toBeLessThan(firstContentIdx)
      expect(info!.reasoning_chars).toBe(5)
      expect(info!.content_chars).toBe(4)
    })
  })
})
