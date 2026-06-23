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

describe("stream-sieve V0.10.2 streaming edge cases", () => {
  describe("#given a parameter value with JSON-special characters", () => {
    test("#when streamed #then args delta is properly escaped", () => {
      const wrapper =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="echo">\n' +
        '<|DSML|parameter name="msg"><![CDATA[hello "world" with\nnewline\\backslash]]></|DSML|parameter>\n' +
        '</|DSML|invoke>\n' +
        '</|DSML|tool_calls>'
      const events = feedAll([wrapper])
      const started = findStarted(events)
      expect(started.length).toBe(1)
      const deltas = findArgDeltas(events, started[0]!.index)
      const concatenated = deltas.join("")
      const parsed = JSON.parse(concatenated) as { msg: string }
      expect(parsed.msg).toBe('hello "world" with\nnewline\\backslash')
    })
  })

  describe("#given numeric and boolean parameter values", () => {
    test("#when streamed #then args delta preserves types", () => {
      const wrapper =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="set_flags">\n' +
        '<|DSML|parameter name="count">42</|DSML|parameter>\n' +
        '<|DSML|parameter name="enabled">true</|DSML|parameter>\n' +
        '</|DSML|invoke>\n' +
        '</|DSML|tool_calls>'
      const events = feedAll([wrapper])
      const started = findStarted(events)
      const deltas = findArgDeltas(events, started[0]!.index)
      const parsed = JSON.parse(deltas.join("")) as Record<string, unknown>
      expect(parsed.count).toBe(42)
      expect(parsed.enabled).toBe(true)
    })
  })

  describe("#given empty invoke (no params)", () => {
    test("#when streamed #then no started, no deltas, no complete (preserves V0.9.5 semantics)", () => {
      const wrapper =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="ping"></|DSML|invoke>\n' +
        '</|DSML|tool_calls>'
      const events = feedAll([wrapper])
      expect(findStarted(events).length).toBe(0)
      expect(findCompletes(events).length).toBe(0)
      expect(
        events.filter((e) => e.type === "tool_call_argument_delta").length,
      ).toBe(0)
    })
  })

  describe("#given truncated stream after first param", () => {
    test("#when ended #then started + delta emitted but no complete (no closing })", () => {
      const partial =
        '<|DSML|tool_calls>\n' +
        '<|DSML|invoke name="get_time">\n' +
        '<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>'
      const events = feedAll([partial])
      const started = findStarted(events)
      expect(started.length).toBe(1)
      const deltas = findArgDeltas(events, started[0]!.index)
      expect(deltas.length).toBe(1)
      expect(deltas[0]).toBe('{"tz":"UTC"')
      expect(findCompletes(events).length).toBe(0)
    })
  })
})
