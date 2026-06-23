/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  createStreamSieve,
  type SieveEvent,
} from "./stream-sieve"
import {
  findArgDeltas,
  findCompletes,
  findStarted,
} from "./stream-sieve-streaming-helpers"

function feedAll(chunks: ReadonlyArray<string>): SieveEvent[] {
  const sieve = createStreamSieve()
  const events: SieveEvent[] = []
  for (const c of chunks) events.push(...sieve.feed(c))
  events.push(...sieve.end())
  return events
}

describe("stream-sieve V0.10.2 streaming sequence", () => {
  describe("#given a single param tool call", () => {
    test("#when streamed #then started + arg delta + closing delta + complete in order", () => {
      const wrapper =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="get_time">\n' +
        '<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>\n' +
        '</|DSML|invoke>\n' +
        '</|DSML|tool_calls>'
      const events = feedAll([wrapper])
      const started = findStarted(events)
      expect(started.length).toBe(1)
      expect(started[0]!.name).toBe("get_time")
      expect(started[0]!.id).toMatch(/^call_[0-9a-f]+$/)
      const deltas = findArgDeltas(events, started[0]!.index)
      expect(deltas.length).toBe(2)
      expect(deltas[0]).toBe('{"tz":"UTC"')
      expect(deltas[1]).toBe("}")
      expect(JSON.parse(deltas.join(""))).toEqual({ tz: "UTC" })
      const completes = findCompletes(events)
      expect(completes.length).toBe(1)
      const startedIdx = events.findIndex((e) => e.type === "tool_call_started")
      const firstDeltaIdx = events.findIndex(
        (e) => e.type === "tool_call_argument_delta",
      )
      const completeIdx = events.findIndex(
        (e) => e.type === "tool_call_complete",
      )
      expect(startedIdx).toBeLessThan(firstDeltaIdx)
      expect(firstDeltaIdx).toBeLessThan(completeIdx)
    })
  })

  describe("#given a multi-param tool call", () => {
    test("#when streamed #then first delta uses { and subsequent uses ,", () => {
      const wrapper =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="search">\n' +
        '<|DSML|parameter name="q"><![CDATA[bun]]></|DSML|parameter>\n' +
        '<|DSML|parameter name="lang"><![CDATA[en]]></|DSML|parameter>\n' +
        '</|DSML|invoke>\n' +
        '</|DSML|tool_calls>'
      const events = feedAll([wrapper])
      const started = findStarted(events)
      expect(started.length).toBe(1)
      const deltas = findArgDeltas(events, started[0]!.index)
      expect(deltas.length).toBe(3)
      expect(deltas[0]).toBe('{"q":"bun"')
      expect(deltas[1]).toBe(',"lang":"en"')
      expect(deltas[2]).toBe("}")
      expect(JSON.parse(deltas.join(""))).toEqual({ q: "bun", lang: "en" })
    })
  })

  describe("#given chunked stream with invoke open before any param", () => {
    test("#when streamed #then started is buffered until first param close", () => {
      const sieve = createStreamSieve()
      const ev1 = sieve.feed(
        '<|DSML|tool_calls>\n<|DSML|invoke name="get_time">\n',
      )
      expect(findStarted(ev1).length).toBe(0)
      const ev2 = sieve.feed(
        '<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>\n',
      )
      const startedEv2 = findStarted(ev2)
      expect(startedEv2.length).toBe(1)
      expect(startedEv2[0]!.name).toBe("get_time")
      expect(findArgDeltas(ev2, startedEv2[0]!.index)[0]).toBe('{"tz":"UTC"')
      const ev3 = sieve.feed('</|DSML|invoke>\n</|DSML|tool_calls>')
      expect(findArgDeltas(ev3, startedEv2[0]!.index)[0]).toBe("}")
      expect(findCompletes(ev3).length).toBe(1)
      sieve.end()
    })
  })

  describe("#given two tool calls in one wrapper", () => {
    test("#when streamed #then each gets its own index and separate deltas", () => {
      const wrapper =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="get_time">\n' +
        '<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>\n' +
        '</|DSML|invoke>\n' +
        '<|DSML|invoke name="search">\n' +
        '<|DSML|parameter name="q"><![CDATA[bun]]></|DSML|parameter>\n' +
        '</|DSML|invoke>\n' +
        '</|DSML|tool_calls>'
      const events = feedAll([wrapper])
      const started = findStarted(events)
      expect(started.length).toBe(2)
      expect(started[0]!.name).toBe("get_time")
      expect(started[1]!.name).toBe("search")
      expect(started[0]!.index).toBe(0)
      expect(started[1]!.index).toBe(1)
      expect(JSON.parse(findArgDeltas(events, 0).join(""))).toEqual({ tz: "UTC" })
      expect(JSON.parse(findArgDeltas(events, 1).join(""))).toEqual({ q: "bun" })
    })
  })
})
