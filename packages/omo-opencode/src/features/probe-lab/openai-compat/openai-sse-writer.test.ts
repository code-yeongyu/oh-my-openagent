import { describe, expect, test } from "bun:test"
import type { SseEvent } from "./deepseek-sse-reader"
import {
  buildOpenAIStream,
  type OpenAIStreamCompletion,
} from "./openai-sse-writer"

async function* events(
  data: ReadonlyArray<string>,
): AsyncGenerator<SseEvent, void, void> {
  for (const d of data) yield { data: d }
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

function parseChunkLines(raw: string): ReadonlyArray<string> {
  return raw
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("data: "))
    .map((s) => s.slice(6))
}

type Chunk = {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: { role?: string; content?: string }
    finish_reason: string | null
  }>
}

describe("buildOpenAIStream", () => {
  describe("#given two content APPEND events and a FINISHED status", () => {
    test("#when streamed #then emits role chunk, content chunks, final stop chunk, and [DONE]", async () => {
      let info: OpenAIStreamCompletion | null = null
      const stream = buildOpenAIStream({
        events: events([
          '{"p":"response/content","o":"APPEND","v":"hello"}',
          '{"p":"response/content","o":"APPEND","v":" world"}',
          '{"p":"response/status","v":"FINISHED"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-resp-1",
        onComplete: (i) => {
          info = i
        },
      })
      const raw = await readAll(stream)
      const lines = parseChunkLines(raw)
      expect(lines[lines.length - 1]).toBe("[DONE]")
      const chunks = lines
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l) as Chunk)
      expect(chunks).toHaveLength(4)
      expect(chunks[0]!.choices[0]!.delta.role).toBe("assistant")
      expect(chunks[0]!.choices[0]!.finish_reason).toBeNull()
      expect(chunks[1]!.choices[0]!.delta.content).toBe("hello")
      expect(chunks[2]!.choices[0]!.delta.content).toBe(" world")
      expect(chunks[3]!.choices[0]!.finish_reason).toBe("stop")
      expect(chunks[3]!.choices[0]!.delta).toEqual({})
      expect(info).not.toBeNull()
      expect(info!.content_chars).toBe(11)
      expect(info!.chunk_count).toBe(4)
      expect(info!.finish_reason).toBe("stop")
    })
  })

  describe("#given DeepSeek shorthand v-only frames after initial APPEND (real protocol)", () => {
    test("#when streamed #then ALL deltas are emitted, not just the first APPEND", async () => {
      let info: OpenAIStreamCompletion | null = null
      const stream = buildOpenAIStream({
        events: events([
          '{"p":"response/content","o":"APPEND","v":"Ros"}',
          '{"v":"so"}',
          '{"v":"  \\n"}',
          '{"v":"Ver"}',
          '{"v":"de"}',
          '{"v":"  \\n"}',
          '{"v":"Bl"}',
          '{"v":"u"}',
          '{"p":"response/accumulated_token_usage","o":"SET","v":52}',
          '{"p":"response/status","v":"FINISHED"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-shorthand",
        onComplete: (i) => { info = i },
      })
      const raw = await readAll(stream)
      const lines = parseChunkLines(raw)
      expect(lines[lines.length - 1]).toBe("[DONE]")
      const chunks = lines.filter((l) => l !== "[DONE]").map((l) => JSON.parse(l) as Chunk)
      const contentChunks = chunks
        .map((c) => c.choices[0]!.delta.content)
        .filter((c): c is string => typeof c === "string")
      expect(contentChunks.join("")).toBe("Rosso  \nVerde  \nBlu")
      expect(info).not.toBeNull()
      expect(info!.content_chars).toBe(19)
      expect(info!.finish_reason).toBe("stop")
      expect(info!.terminal_status).toBe("FINISHED")
      expect(info!.finished).toBe(true)
    })

    test("#when path switches to non-content (token_usage), shorthand v after that is NOT treated as content", async () => {
      const stream = buildOpenAIStream({
        events: events([
          '{"p":"response/content","o":"APPEND","v":"hi"}',
          '{"p":"response/accumulated_token_usage","o":"SET","v":10}',
          '{"v":99}',
          '{"p":"response/status","v":"FINISHED"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-pathswitch",
      })
      const raw = await readAll(stream)
      const chunks = parseChunkLines(raw)
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l) as Chunk)
      const contentChunks = chunks
        .map((c) => c.choices[0]!.delta.content)
        .filter((c): c is string => typeof c === "string")
      expect(contentChunks).toEqual(["hi"])
    })
  })

  describe("#given truncation (no terminal status arrives)", () => {
    test("#when streamed #then final chunk has finish_reason=length and [DONE] still emitted", async () => {
      const stream = buildOpenAIStream({
        events: events([
          '{"p":"response/content","o":"APPEND","v":"abc"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-trunc",
      })
      const raw = await readAll(stream)
      const lines = parseChunkLines(raw)
      expect(lines[lines.length - 1]).toBe("[DONE]")
      const chunks = lines
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l) as Chunk)
      const last = chunks[chunks.length - 1]!
      expect(last.choices[0]!.finish_reason).toBe("length")
    })
  })

  describe("#given non-FINISHED terminal status (e.g. ERROR)", () => {
    test("#when streamed #then finish_reason=stop (best-effort), [DONE] emitted", async () => {
      const stream = buildOpenAIStream({
        events: events([
          '{"p":"response/content","o":"APPEND","v":"x"}',
          '{"p":"response/status","v":"ERROR"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-err",
      })
      const raw = await readAll(stream)
      const lines = parseChunkLines(raw)
      const chunks = lines
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l) as Chunk)
      const last = chunks[chunks.length - 1]!
      expect(last.choices[0]!.finish_reason).toBe("stop")
      expect(lines[lines.length - 1]).toBe("[DONE]")
    })
  })

  describe("#given a ready event with nested response.status WIP", () => {
    test("#when streamed #then nested status is captured (later FINISHED overrides)", async () => {
      const stream = buildOpenAIStream({
        events: events([
          '{"v":{"response":{"status":"WIP"}}}',
          '{"p":"response/content","o":"APPEND","v":"ok"}',
          '{"p":"response/status","v":"FINISHED"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-ready",
      })
      const raw = await readAll(stream)
      const lines = parseChunkLines(raw)
      const chunks = lines
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l) as Chunk)
      expect(chunks[chunks.length - 1]!.choices[0]!.finish_reason).toBe("stop")
    })
  })

  describe("#given malformed JSON in an event", () => {
    test("#when streamed #then bad chunks are skipped without aborting the stream", async () => {
      const stream = buildOpenAIStream({
        events: events([
          "not-json-at-all",
          '{"p":"response/content","o":"APPEND","v":"only"}',
          '{"p":"response/status","v":"FINISHED"}',
        ]),
        model: "deepseek-chat",
        responseId: "chatcmpl-bad",
      })
      const raw = await readAll(stream)
      const lines = parseChunkLines(raw)
      const chunks = lines
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l) as Chunk)
      const contentChunks = chunks
        .map((c) => c.choices[0]!.delta.content)
        .filter((c): c is string => typeof c === "string")
      expect(contentChunks).toEqual(["only"])
    })
  })

  describe("#given iterator throws mid-stream", () => {
    test("#when streamed #then emits an error chunk in OpenAI shape and [DONE]", async () => {
      const errIter: AsyncIterable<SseEvent> = {
        [Symbol.asyncIterator]() {
          let n = 0
          return {
            async next() {
              if (n === 0) {
                n++
                return {
                  value: {
                    data: '{"p":"response/content","o":"APPEND","v":"hi"}',
                  },
                  done: false,
                }
              }
              throw new Error("upstream-broke")
            },
          }
        },
      }
      const stream = buildOpenAIStream({
        events: errIter,
        model: "deepseek-chat",
        responseId: "chatcmpl-thrown",
      })
      const raw = await readAll(stream)
      expect(raw).toContain("upstream-broke")
      expect(raw).toContain("internal_error")
      expect(raw.endsWith("data: [DONE]\n\n")).toBe(true)
    })
  })
})
