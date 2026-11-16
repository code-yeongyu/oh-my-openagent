import { describe, expect, test } from "bun:test"

import { parseEvents, type SentinelEvent } from "./events.ts"
import { samplerGapFault } from "./sampler-gap.ts"

// The 20 Hz sampler runs on the recorder's main thread. A gap in its ticks longer than 250 ms means a sampled signal
// could have changed and changed back unseen, so the run is invalid. The fault names what held the sampler: its own
// slowest read in the gap (the recorder reports a slow_tick fact for a tick that took long), or, when no read of its
// own was slow, the main thread being busy elsewhere.

const ticks = (from: number, to: number): SentinelEvent[] => {
  const events: SentinelEvent[] = []
  for (let t = from; t <= to; t += 50) events.push({ t, kind: "tick" })
  return events
}
const slowTick = (t: number, read: string, readMs: number): SentinelEvent => ({
  t,
  kind: "slow_tick",
  ms: readMs + 5,
  read,
  readMs,
})
const run = (events: SentinelEvent[]): SentinelEvent[] => [...events].sort((a, b) => a.t - b.t)

describe("sampler gap", () => {
  test("a sampler that ticked every 50 ms has no fault", () => {
    expect(samplerGapFault(run(ticks(1_000, 3_000)), 1_000, 3_000)).toBeUndefined()
  })

  test("a gap held by one of the sampler's own reads names that read", () => {
    const events = run([...ticks(1_000, 1_200), slowTick(1_795, "window list", 590), ...ticks(1_800, 3_000)])
    expect(samplerGapFault(events, 1_000, 3_000)).toBe(
      "sampler: no tick for 600 ms (20 Hz expected; slowest sampler read in it: window list 590 ms)",
    )
  })

  test("of several slow ticks in the gap, the slowest read is named", () => {
    const events = run([
      ...ticks(1_000, 1_200),
      slowTick(1_390, "focus", 120),
      slowTick(1_795, "pasteboard", 400),
      ...ticks(1_800, 3_000),
    ])
    expect(samplerGapFault(events, 1_000, 3_000)).toBe(
      "sampler: no tick for 600 ms (20 Hz expected; slowest sampler read in it: pasteboard 400 ms)",
    )
  })

  test("a gap with no slow read of the sampler's own says the main thread was busy elsewhere", () => {
    const events = run([...ticks(1_000, 1_200), slowTick(2_500, "focus", 150), ...ticks(1_800, 3_000)])
    expect(samplerGapFault(events, 1_000, 3_000)).toBe(
      "sampler: no tick for 600 ms (20 Hz expected; no sampler read was slow in it, so the recorder's main thread was busy elsewhere)",
    )
  })

  test("the gap from start to the first tick, and from the last tick to stop, counts", () => {
    expect(samplerGapFault(run(ticks(1_400, 3_000)), 1_000, 3_000)).toStartWith("sampler: no tick for 400 ms")
    expect(samplerGapFault(run(ticks(1_000, 2_600)), 1_000, 3_000)).toStartWith("sampler: no tick for 400 ms")
  })

  test("a slow_tick fact is a sentinel event; one without its read is not", () => {
    expect(parseEvents('{"t":5,"kind":"slow_tick","ms":125,"read":"pasteboard","readMs":120}').events).toEqual([
      slowTick(5, "pasteboard", 120),
    ])
    expect(parseEvents('{"t":5,"kind":"slow_tick","ms":130}').faults).toHaveLength(1)
  })
})
