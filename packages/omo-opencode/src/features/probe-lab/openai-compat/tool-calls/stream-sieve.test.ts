/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  collectAll,
  createStreamSieve,
  type SieveEvent,
} from "./stream-sieve"

function feedAll(chunks: ReadonlyArray<string>): SieveEvent[] {
  const sieve = createStreamSieve()
  const events: SieveEvent[] = []
  for (const c of chunks) events.push(...sieve.feed(c))
  events.push(...sieve.end())
  return events
}

function contentsOf(events: ReadonlyArray<SieveEvent>): string {
  return events
    .filter((e): e is { type: "content"; text: string } => e.type === "content")
    .map((e) => e.text)
    .join("")
}

function toolCallsOf(events: ReadonlyArray<SieveEvent>): Array<{
  name: string
  arguments: Record<string, unknown>
}> {
  return events
    .filter(
      (e): e is Extract<SieveEvent, { type: "tool_call_complete" }> =>
        e.type === "tool_call_complete",
    )
    .map((e) => e.call)
}

describe("createStreamSieve (V0.9.5)", () => {
  describe("T01 #given plain content stream with no DSML", () => {
    test("#when streamed in chunks #then ALL chunks emitted as content, no tool_calls", () => {
      const events = feedAll(["hello ", "world ", "from ", "deepseek"])
      expect(contentsOf(events)).toBe("hello world from deepseek")
      expect(toolCallsOf(events)).toHaveLength(0)
      expect(events[events.length - 1]!.type).toBe("stream_end")
    })
  })

  describe("T02 #given a single complete invoke streamed in 5+ chunks", () => {
    test("#when streamed #then ZERO content emitted during DSML buffering, tool_call_complete after </invoke>", () => {
      const wrapper = `<|DSML|tool_calls>\n<|DSML|invoke name="get_current_time">\n<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>`
      const chunks: string[] = []
      const chunkSize = Math.ceil(wrapper.length / 6)
      for (let i = 0; i < wrapper.length; i += chunkSize) {
        chunks.push(wrapper.slice(i, i + chunkSize))
      }
      const events = feedAll(chunks)
      expect(contentsOf(events)).toBe("")
      const calls = toolCallsOf(events)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.name).toBe("get_current_time")
      expect(calls[0]!.arguments).toEqual({ tz: "UTC" })
    })
  })

  describe("T03 #given mid-stream switch from prose to DSML", () => {
    test("#when streamed #then prose emitted as content, DSML buffered, then tool_call_complete", () => {
      const events = feedAll([
        "Sure, calling now: ",
        `<|DSML|tool_calls>\n<|DSML|invoke name="get_current_time">\n<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>`,
      ])
      expect(contentsOf(events)).toBe("Sure, calling now: ")
      const calls = toolCallsOf(events)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.name).toBe("get_current_time")
    })
  })

  describe("T04 #given multi-tool stream with 2 invokes within one wrapper", () => {
    test("#when streamed #then 2 tool_call_complete events in order", () => {
      const wrapper = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="search_web">
<|DSML|parameter name="query"><![CDATA[bun]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const events = feedAll([wrapper])
      const calls = toolCallsOf(events)
      expect(calls).toHaveLength(2)
      expect(calls[0]!.name).toBe("get_current_time")
      expect(calls[1]!.name).toBe("search_web")
      expect(contentsOf(events)).toBe("")
    })
  })

  describe("T05 #given partial chunk arriving mid-tag", () => {
    test("#when chunk ends inside the opener #then buffer waits for next chunk and emits tool_call only after closer", () => {
      const sieve = createStreamSieve()
      const ev1 = sieve.feed("<|DSML|to")
      expect(ev1).toHaveLength(0)
      const ev2 = sieve.feed("ol_calls>")
      expect(toolCallsOf(ev2)).toHaveLength(0)
      expect(contentsOf(ev2)).toBe("")
      const ev3 = sieve.feed(
        `<|DSML|invoke name="x"><|DSML|parameter name="y"><![CDATA[v]]></|DSML|parameter></|DSML|invoke></|DSML|tool_calls>`,
      )
      const ev4 = sieve.end()
      const all = [...ev1, ...ev2, ...ev3, ...ev4]
      const calls = toolCallsOf(all)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.name).toBe("x")
      expect(calls[0]!.arguments).toEqual({ y: "v" })
    })
  })

  describe("T06 #given DSML noise tolerance (missing pipe variant)", () => {
    test("#when streamed #then sieve normalizes via scanner before parsing", () => {
      const noisy = `<|DSML tool_calls>
<|DSML invoke name="get_current_time">
<|DSML parameter name="tz"><![CDATA[UTC]]></|DSML parameter>
</|DSML invoke>
</|DSML tool_calls>`
      const events = feedAll([noisy])
      const calls = toolCallsOf(events)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.name).toBe("get_current_time")
    })
  })

  describe("T07 #given fenced code block with DSML inside", () => {
    test("#when streamed #then NEVER emit as tool_call, ALWAYS as content", () => {
      const fenced = `Here's an example:\n\`\`\`\n<|DSML|tool_calls>\n<|DSML|invoke name="get_current_time"></|DSML|invoke>\n</|DSML|tool_calls>\n\`\`\`\nDone.`
      const events = feedAll([fenced])
      expect(toolCallsOf(events)).toHaveLength(0)
      const content = contentsOf(events)
      expect(content).toBe(fenced)
    })
  })

  describe("T08 #given empty <invoke></invoke>", () => {
    test("#when streamed #then no tool_call event AND DSML markup stripped from content", () => {
      const wrapper = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time"></|DSML|invoke>
</|DSML|tool_calls>`
      const events = feedAll([wrapper])
      expect(toolCallsOf(events)).toHaveLength(0)
      expect(contentsOf(events)).toBe("")
    })
  })

  describe("T09 #given stream ends mid-invoke (no </invoke>)", () => {
    test("#when end #then no tool_call emitted (truncated DSML stripped)", () => {
      const truncated = `<|DSML|tool_calls>\n<|DSML|invoke name="get_current_time">\n<|DSML|parameter name="tz"><![CDATA[UTC`
      const events = feedAll([truncated])
      expect(toolCallsOf(events)).toHaveLength(0)
      expect(contentsOf(events)).toBe("")
    })
  })

  describe("T10 #given invoke at very start of stream (no prefix prose)", () => {
    test("#when streamed #then no content emitted before tool_call_complete", () => {
      const wrapper = `<|DSML|tool_calls><|DSML|invoke name="x"><|DSML|parameter name="y"><![CDATA[v]]></|DSML|parameter></|DSML|invoke></|DSML|tool_calls>`
      const events = feedAll([wrapper])
      const idxFirstContent = events.findIndex((e) => e.type === "content" && e.text.length > 0)
      const idxFirstCall = events.findIndex((e) => e.type === "tool_call_complete")
      expect(idxFirstCall).toBeGreaterThanOrEqual(0)
      if (idxFirstContent >= 0) {
        expect(idxFirstContent).toBeGreaterThan(idxFirstCall)
      }
      expect(toolCallsOf(events)).toHaveLength(1)
    })
  })

  describe("collectAll #given an async iterable of chunks", () => {
    test("#when consumed #then yields the same events as feed/end loop", async () => {
      async function* chunks(): AsyncIterable<string> {
        yield "hello "
        yield `<|DSML|tool_calls>\n<|DSML|invoke name="x"><|DSML|parameter name="y"><![CDATA[v]]></|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls>`
      }
      const events: SieveEvent[] = []
      for await (const e of collectAll(chunks())) events.push(e)
      expect(contentsOf(events)).toBe("hello ")
      expect(toolCallsOf(events)).toHaveLength(1)
    })
  })
})
