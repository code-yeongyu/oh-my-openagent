import { describe, expect, test } from "bun:test"
import { parseSseStream, type SseEvent } from "./deepseek-sse-reader"

function streamFromChunks(
  chunks: ReadonlyArray<string | Uint8Array>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      const c = chunks[i++]!
      controller.enqueue(typeof c === "string" ? enc.encode(c) : c)
    },
  })
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<ReadonlyArray<SseEvent>> {
  const out: SseEvent[] = []
  for await (const ev of parseSseStream(stream)) out.push(ev)
  return out
}

describe("parseSseStream", () => {
  describe("#given a single complete event line", () => {
    test("#when stream emits one chunk with data: + blank line #then yields one event with the data payload", async () => {
      const events = await collect(streamFromChunks(['data: hello\n\n']))
      expect(events).toHaveLength(1)
      expect(events[0]!.data).toBe("hello")
      expect(events[0]!.event).toBeUndefined()
    })
  })

  describe("#given an event field followed by data", () => {
    test("#when emitted #then yields an event with both event name and data", async () => {
      const events = await collect(
        streamFromChunks(["event: ready\ndata: {\"v\":\"x\"}\n\n"]),
      )
      expect(events).toHaveLength(1)
      expect(events[0]!.event).toBe("ready")
      expect(events[0]!.data).toBe('{"v":"x"}')
    })
  })

  describe("#given a single event split across multiple chunks at byte boundaries", () => {
    test("#when emitted #then partial-line buffer reassembles correctly", async () => {
      const events = await collect(
        streamFromChunks([
          "data: {\"p\":\"resp",
          "onse/conte",
          "nt\",\"o\":\"APPEND\",\"v\":\"hi",
          " world\"}\n\n",
        ]),
      )
      expect(events).toHaveLength(1)
      expect(events[0]!.data).toBe(
        '{"p":"response/content","o":"APPEND","v":"hi world"}',
      )
    })
  })

  describe("#given multiple events back-to-back", () => {
    test("#when emitted #then yields each event in order", async () => {
      const events = await collect(
        streamFromChunks([
          'data: {"v":"a","p":"response/content","o":"APPEND"}\n\n',
          'data: {"v":"b","p":"response/content","o":"APPEND"}\n\n',
          'data: {"v":"FINISHED","p":"response/status"}\n\n',
        ]),
      )
      expect(events).toHaveLength(3)
      expect(events[0]!.data).toMatch(/"v":"a"/)
      expect(events[1]!.data).toMatch(/"v":"b"/)
      expect(events[2]!.data).toMatch(/FINISHED/)
    })
  })

  describe("#given a comment line starting with colon", () => {
    test("#when emitted #then comment is ignored", async () => {
      const events = await collect(
        streamFromChunks([": keep-alive comment\ndata: payload\n\n"]),
      )
      expect(events).toHaveLength(1)
      expect(events[0]!.data).toBe("payload")
    })
  })

  describe("#given multi-line data fields", () => {
    test("#when emitted #then concatenates data with newline separator", async () => {
      const events = await collect(
        streamFromChunks(["data: line1\ndata: line2\n\n"]),
      )
      expect(events).toHaveLength(1)
      expect(events[0]!.data).toBe("line1\nline2")
    })
  })

  describe("#given CRLF line endings", () => {
    test("#when emitted #then trailing \\r is stripped", async () => {
      const events = await collect(
        streamFromChunks(["data: with-crlf\r\n\r\n"]),
      )
      expect(events).toHaveLength(1)
      expect(events[0]!.data).toBe("with-crlf")
    })
  })

  describe("#given stream ends without trailing blank line", () => {
    test("#when stream closes mid-event #then final event is still flushed", async () => {
      const events = await collect(streamFromChunks(["data: dangling"]))
      expect(events).toHaveLength(1)
      expect(events[0]!.data).toBe("dangling")
    })
  })
})
