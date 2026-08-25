import { describe, expect, test } from "bun:test"

import {
  FACTS_FAILURES_VERSION,
  FactsFailuresCorruptError,
  parseFailuresFile,
  renderFailuresFile,
  type FactsFailureRecord,
} from "./failures-schema"

const T0 = "2026-08-16T00:00:00.000Z"

function record(overrides: Partial<FactsFailureRecord> = {}): FactsFailureRecord {
  return {
    conversationId: "conversation-alpha",
    end_message_id: "m2",
    end_snapshot_line: 4,
    state: "backoff",
    streak: 1,
    firstFailureAt: T0,
    lastFailureAt: T0,
    lastReason: "child_exit",
    lastFailureId: "run-a",
    nextEligibleAt: "2026-08-16T00:01:00.000Z",
    ...overrides,
  }
}

describe("facts failures file parsing", () => {
  test("#given a well-formed file #when it is parsed #then every record round-trips", () => {
    // given
    const rendered = renderFailuresFile([record()], T0)

    // when
    const parsed = parseFailuresFile(rendered)

    // then
    expect(parsed.version).toBe(FACTS_FAILURES_VERSION)
    expect(parsed.updatedAt).toBe(T0)
    expect(parsed.entries).toEqual([record()])
  })

  test("#given corrupt JSON #when it is parsed #then a typed error is thrown instead of empty state", () => {
    // given
    const raw = "{ not json"

    // when / then
    expect(() => parseFailuresFile(raw)).toThrow(FactsFailuresCorruptError)
  })

  test("#given an unsupported version #when it is parsed #then a typed error is thrown", () => {
    // given
    const raw = JSON.stringify({ version: 2, updatedAt: T0, entries: [] })

    // when / then
    expect(() => parseFailuresFile(raw)).toThrow(FactsFailuresCorruptError)
  })

  test("#given a record with an unknown reason #when it is parsed #then a typed error is thrown", () => {
    // given
    const raw = JSON.stringify({
      version: FACTS_FAILURES_VERSION,
      updatedAt: T0,
      entries: [{ ...record(), lastReason: "meteor_strike" }],
    })

    // when / then
    expect(() => parseFailuresFile(raw)).toThrow(FactsFailuresCorruptError)
  })

  test("#given a parked record without parkedAt #when it is parsed #then a typed error is thrown", () => {
    // given
    const raw = JSON.stringify({
      version: FACTS_FAILURES_VERSION,
      updatedAt: T0,
      entries: [{ ...record(), state: "parked", nextEligibleAt: null }],
    })

    // when / then
    expect(() => parseFailuresFile(raw)).toThrow(FactsFailuresCorruptError)
  })

  test("#given a record with a non-ISO instant #when it is parsed #then a typed error is thrown", () => {
    // given: a NaN instant would make every `now < nextEligibleAt` comparison false, turning a
    // corrupt record into a permanently launchable one - fail-OPEN. Each field is probed alone.
    const corrupt: readonly (readonly [string, unknown])[] = [
      ["firstFailureAt", "yesterday"],
      ["lastFailureAt", "2026-08-16"],
      ["nextEligibleAt", "soon"],
      ["parkedAt", "not-a-date"],
    ]

    // when / then
    for (const [field, value] of corrupt) {
      const base = field === "parkedAt" ? record({ state: "parked", nextEligibleAt: null }) : record()
      const raw = JSON.stringify({
        version: FACTS_FAILURES_VERSION,
        updatedAt: T0,
        entries: [{ ...base, [field]: value }],
      })
      expect(() => parseFailuresFile(raw)).toThrow(FactsFailuresCorruptError)
    }
  })

  test("#given a non-ISO file updatedAt #when it is parsed #then a typed error is thrown", () => {
    // given
    const raw = JSON.stringify({ version: FACTS_FAILURES_VERSION, updatedAt: "not-a-date", entries: [] })

    // when / then
    expect(() => parseFailuresFile(raw)).toThrow(FactsFailuresCorruptError)
  })

  test("#given a parked record with a null nextEligibleAt #when it is parsed #then null stays valid", () => {
    // given: nullable is not the same as unvalidated - null must survive the instant check.
    const parked = record({ state: "parked", streak: 5, nextEligibleAt: null, parkedAt: T0 })

    // when
    const parsed = parseFailuresFile(renderFailuresFile([parked], T0))

    // then
    expect(parsed.entries).toEqual([parked])
  })

  test("#given unsorted records #when the file is rendered #then output is sorted and newline-terminated", () => {
    // given
    const entries = [
      record({ conversationId: "b-conversation", end_snapshot_line: 4, end_message_id: "m2" }),
      record({ conversationId: "a-conversation", end_snapshot_line: 9, end_message_id: "m9" }),
      record({ conversationId: "a-conversation", end_snapshot_line: 4, end_message_id: "m5" }),
      record({ conversationId: "a-conversation", end_snapshot_line: 4, end_message_id: "m2" }),
    ]

    // when
    const rendered = renderFailuresFile(entries, T0)

    // then
    expect(rendered.endsWith("\n")).toBe(true)
    expect(parseFailuresFile(rendered).entries.map((row) => [row.conversationId, row.end_snapshot_line, row.end_message_id])).toEqual([
      ["a-conversation", 4, "m2"],
      ["a-conversation", 4, "m5"],
      ["a-conversation", 9, "m9"],
      ["b-conversation", 4, "m2"],
    ])
  })
})
