import { describe, expect, test } from "bun:test"

import {
  MAX_FACTS_PAYLOAD_BYTES,
  measureFactsPayloadBytes,
  selectCappedFactsBatch,
  serializeFactsPayload,
} from "./payload-cap"
import type { FactsPayload } from "./extraction"
import { FACTS_QUEUE_VERSION, type FactsQueueEntry } from "./schema"

const T0 = new Date("2026-08-16T00:00:00.000Z")
const ENVELOPE = {
  version: 1,
  identity: "facts-agent",
  today: "2026-08-16",
  knownPeople: [],
  primaryHuman: { slug: "human", aliases: [] },
} as const satisfies Omit<FactsPayload, "entries">

function entry(
  conversationId: string,
  endMessageId: string,
  endSnapshotLine: number,
  options: { readonly text?: string; readonly enqueuedAt?: Date } = {},
): FactsQueueEntry {
  return {
    version: FACTS_QUEUE_VERSION,
    identity: "facts-agent",
    sessionId: conversationId,
    conversationId,
    range: {
      start_message_id: `${endMessageId}-start`,
      end_message_id: endMessageId,
      start_line: Math.max(endSnapshotLine - 1, 0),
      end_snapshot_line: endSnapshotLine,
    },
    enqueuedAt: (options.enqueuedAt ?? T0).toISOString(),
    entries: [{
      kind: "user",
      text: options.text ?? `${conversationId}/${endMessageId}`,
      captured_at: T0.toISOString(),
      source_line_id: `${endMessageId}:user`,
      source_message_id: endMessageId,
    }],
  }
}

function endpoints(selected: readonly FactsQueueEntry[]): readonly string[] {
  return selected.map((candidate) => `${candidate.conversationId}/${candidate.range.end_message_id}`)
}

/** Grows one entry's transcript text until the whole payload measures exactly `target` bytes. */
function entrySizedTo(
  conversationId: string,
  endMessageId: string,
  endSnapshotLine: number,
  target: number,
): FactsQueueEntry {
  let padding = 1
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = entry(conversationId, endMessageId, endSnapshotLine, { text: "x".repeat(padding) })
    const bytes = measureFactsPayloadBytes({ ...ENVELOPE, entries: [candidate] })
    if (bytes === target) return candidate
    if (bytes > target) throw new Error(`cannot size entry to ${target} bytes (overshot at ${bytes})`)
    padding += target - bytes
  }
  throw new Error(`entry sizing did not converge on ${target} bytes`)
}

describe("facts payload measurement", () => {
  test("#given a payload #when it is measured #then the bytes equal the shared serializer's utf8 length", () => {
    // given
    const payload: FactsPayload = { ...ENVELOPE, entries: [entry("alpha", "m1", 1, { text: "café ☕" })] }

    // when
    const measured = measureFactsPayloadBytes(payload)

    // then: the writer and the measurement MUST agree byte for byte.
    expect(serializeFactsPayload(payload)).toBe(`${JSON.stringify(payload, null, 2)}\n`)
    expect(measured).toBe(Buffer.byteLength(serializeFactsPayload(payload), "utf8"))
    expect(measured).toBeGreaterThan(Buffer.byteLength(JSON.stringify(payload), "utf8"))
  })

  test("#given the cap constant #when it is read #then it is 131072 bytes", () => {
    // then
    expect(MAX_FACTS_PAYLOAD_BYTES).toBe(131_072)
  })
})

describe("facts capped batch selection", () => {
  test("#given a payload exactly at the cap #when selecting #then the entry is accepted, and one byte more is rejected", () => {
    // given
    const exact = entrySizedTo("alpha", "m1", 1, MAX_FACTS_PAYLOAD_BYTES)
    const over = entrySizedTo("beta", "m1", 1, MAX_FACTS_PAYLOAD_BYTES + 1)

    // when
    const accepted = selectCappedFactsBatch({ entries: [exact], envelope: ENVELOPE, now: T0 })
    const rejected = selectCappedFactsBatch({ entries: [over], envelope: ENVELOPE, now: T0 })

    // then
    expect(measureFactsPayloadBytes({ ...ENVELOPE, entries: [exact] })).toBe(MAX_FACTS_PAYLOAD_BYTES)
    expect(endpoints(accepted.selected)).toEqual(["alpha/m1"])
    expect(measureFactsPayloadBytes({ ...ENVELOPE, entries: [over] })).toBe(MAX_FACTS_PAYLOAD_BYTES + 1)
    expect(rejected.selected).toEqual([])
    expect(rejected.oversized.map((candidate) => candidate.range.end_message_id)).toEqual(["m1"])
  })

  test("#given a conversation whose newest entry fits but whose older one does not #when selecting #then prefix closure ships neither", () => {
    // given: naive newest-first would take alpha/m2 and strand alpha/m1 behind an advanced watermark.
    const older = entrySizedTo("alpha", "m1", 1, MAX_FACTS_PAYLOAD_BYTES - 200)
    const newer = entry("alpha", "m2", 2)
    const other = entry("beta", "m9", 1)

    // when
    const selection = selectCappedFactsBatch({
      entries: [older, newer, other],
      envelope: ENVELOPE,
      now: T0,
      maxBytes: MAX_FACTS_PAYLOAD_BYTES - 400,
    })

    // then
    expect(endpoints(selection.selected)).toEqual(["beta/m9"])
    expect(measureFactsPayloadBytes({ ...ENVELOPE, entries: selection.selected }))
      .toBeLessThanOrEqual(MAX_FACTS_PAYLOAD_BYTES - 400)
  })

  test("#given a middle entry that does not fit #when a tiny entry follows it #then the follower is held back too", () => {
    // given: alpha/m3 would fit beside alpha/m1, but shipping it while alpha/m2 stays queued
    // advances the consumed watermark past unextracted transcript - the loss closure forbids.
    const first = entry("alpha", "m1", 1, { text: "y".repeat(3_000) })
    const middle = entry("alpha", "m2", 2, { text: "z".repeat(3_000) })
    const last = entry("alpha", "m3", 3)
    const budget = measureFactsPayloadBytes({ ...ENVELOPE, entries: [first, last] }) + 100

    // when
    const selection = selectCappedFactsBatch({
      entries: [first, middle, last],
      envelope: ENVELOPE,
      now: T0,
      maxBytes: budget,
    })

    // then: the middle entry fits on its own, so it is a cap decision - not an oversize park.
    expect(measureFactsPayloadBytes({ ...ENVELOPE, entries: [middle] })).toBeLessThanOrEqual(budget)
    expect(endpoints(selection.selected)).toEqual(["alpha/m1"])
    expect(selection.oversized).toEqual([])
  })

  test("#given a fitting older entry #when its newer sibling does not fit #then only the closed prefix ships", () => {
    // given
    const older = entry("alpha", "m1", 1)
    const newer = entrySizedTo("alpha", "m2", 2, MAX_FACTS_PAYLOAD_BYTES)

    // when
    const selection = selectCappedFactsBatch({ entries: [older, newer], envelope: ENVELOPE, now: T0 })

    // then
    expect(endpoints(selection.selected)).toEqual(["alpha/m1"])
  })

  test("#given an entry waiting past 24 hours #when newer conversations compete for the cap #then the starved one is selected first", () => {
    // given: byte-identical rivals, so ONLY the waiting time can decide who wins the budget.
    const starved = entry("conv-a", "ma", 1, {
      text: "rival",
      enqueuedAt: new Date(T0.getTime() - 24 * 60 * 60_000),
    })
    const fresh = entry("conv-b", "mb", 1, { text: "rival", enqueuedAt: new Date(T0.getTime() - 60_000) })
    const budget = measureFactsPayloadBytes({ ...ENVELOPE, entries: [starved] })

    // when
    const selection = selectCappedFactsBatch({
      entries: [fresh, starved],
      envelope: ENVELOPE,
      now: T0,
      maxBytes: budget,
    })

    // then
    expect(measureFactsPayloadBytes({ ...ENVELOPE, entries: [fresh] })).toBe(budget)
    expect(endpoints(selection.selected)).toEqual(["conv-a/ma"])
  })

  test("#given an entry waiting just under 24 hours #when newer entries compete #then the newest wins the budget", () => {
    // given: same byte-identical rivals, one millisecond short of the override.
    const almostStarved = entry("conv-a", "ma", 1, {
      text: "rival",
      enqueuedAt: new Date(T0.getTime() - 24 * 60 * 60_000 + 1),
    })
    const fresh = entry("conv-b", "mb", 1, { text: "rival", enqueuedAt: new Date(T0.getTime() - 60_000) })
    const budget = measureFactsPayloadBytes({ ...ENVELOPE, entries: [fresh] })

    // when
    const selection = selectCappedFactsBatch({
      entries: [almostStarved, fresh],
      envelope: ENVELOPE,
      now: T0,
      maxBytes: budget,
    })

    // then
    expect(measureFactsPayloadBytes({ ...ENVELOPE, entries: [almostStarved] })).toBe(budget)
    expect(endpoints(selection.selected)).toEqual(["conv-b/mb"])
  })

  test("#given a multi-conversation batch #when everything fits #then entries ship ascending per conversation", () => {
    // given
    const entries = [
      entry("beta", "m9", 2),
      entry("alpha", "m2", 4),
      entry("beta", "m8", 1),
      entry("alpha", "m1", 3),
    ]

    // when
    const selection = selectCappedFactsBatch({ entries, envelope: ENVELOPE, now: T0 })

    // then: markConsumed relies on ascending per-conversation order for its watermark writes.
    const alpha = selection.selected.filter((candidate) => candidate.conversationId === "alpha")
    const beta = selection.selected.filter((candidate) => candidate.conversationId === "beta")
    expect(alpha.map((candidate) => candidate.range.end_snapshot_line)).toEqual([3, 4])
    expect(beta.map((candidate) => candidate.range.end_snapshot_line)).toEqual([1, 2])
    expect(selection.selected).toHaveLength(4)
    expect(selection.oversized).toEqual([])
  })

  test("#given an oversized entry beside healthy ones #when selecting #then the oversized entry is reported and never truncated", () => {
    // given
    const oversized = entrySizedTo("alpha", "m1", 1, MAX_FACTS_PAYLOAD_BYTES + 1)
    const healthy = entry("beta", "m9", 1)

    // when
    const selection = selectCappedFactsBatch({ entries: [oversized, healthy], envelope: ENVELOPE, now: T0 })

    // then
    expect(endpoints(selection.selected)).toEqual(["beta/m9"])
    expect(selection.oversized).toEqual([oversized])
    expect(selection.oversized[0]?.entries).toEqual(oversized.entries)
  })

  test("#given an envelope that already exceeds the cap #when selecting #then nothing ships", () => {
    // given
    const envelope = { ...ENVELOPE, identity: "x".repeat(MAX_FACTS_PAYLOAD_BYTES) }

    // when
    const selection = selectCappedFactsBatch({ entries: [entry("alpha", "m1", 1)], envelope, now: T0 })

    // then
    expect(selection.selected).toEqual([])
    expect(selection.envelopeOversized).toBe(true)
  })
})
