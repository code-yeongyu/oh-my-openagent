import { describe, expect, test } from "bun:test"

import type { FactsFailureRecord } from "@oh-my-opencode/memory-core"

import {
  factsRemediationHint,
  formatFactsAdvisory,
  formatFactsStatus,
  type FactsOverview,
} from "./facts-status"

const NOW = new Date("2026-08-16T12:00:00.000Z")

function backoffRecord(overrides: Partial<FactsFailureRecord> = {}): FactsFailureRecord {
  return {
    conversationId: "conv-a",
    end_message_id: "msg-a",
    end_snapshot_line: 4,
    state: "backoff",
    streak: 2,
    firstFailureAt: "2026-08-16T11:00:00.000Z",
    lastFailureAt: "2026-08-16T11:50:00.000Z",
    lastReason: "child_exit",
    lastFailureId: "run-1",
    nextEligibleAt: "2026-08-16T12:12:00.000Z",
    ...overrides,
  }
}

function parkedRecord(overrides: Partial<FactsFailureRecord> = {}): FactsFailureRecord {
  return {
    conversationId: "conv-b",
    end_message_id: "msg-b",
    end_snapshot_line: 9,
    state: "parked",
    streak: 5,
    firstFailureAt: "2026-08-16T09:00:00.000Z",
    lastFailureAt: "2026-08-16T11:00:00.000Z",
    lastReason: "deadline_exceeded",
    lastFailureId: "run-5",
    nextEligibleAt: null,
    parkedAt: "2026-08-16T11:00:00.000Z",
    ...overrides,
  }
}

function overview(overrides: Partial<FactsOverview> = {}): FactsOverview {
  return { pending: 0, records: [], now: NOW, ...overrides }
}

describe("facts status rendering", () => {
  test("#given parked and backoff records #when rendering the advisory #then one bounded line names both counts", () => {
    // given
    const state = overview({
      records: [parkedRecord(), parkedRecord({ end_message_id: "msg-c" }), parkedRecord({ end_message_id: "msg-d" }), backoffRecord()],
    })

    // when
    const line = formatFactsAdvisory(state)

    // then
    expect(line).toBe("facts: 3 parked / 1 backoff (next 12m)")
  })

  test("#given no failure records #when rendering the advisory #then nothing is shown", () => {
    // given
    const state = overview({ pending: 2 })

    // when
    const line = formatFactsAdvisory(state)

    // then
    expect(line).toBeUndefined()
  })

  test("#given a corrupt ledger #when rendering the advisory #then it says corrupt instead of zeros", () => {
    // given
    const state = overview({ corrupt: "unexpected token" })

    // when
    const line = formatFactsAdvisory(state)

    // then
    expect(line).toBe("facts: failure ledger unreadable (run /facts for detail)")
  })

  test("#given a corrupt ledger #when rendering the status view #then it reports corruption and no counts", async () => {
    // given
    const state = overview({ pending: 3, corrupt: "unexpected token } in JSON at position 4" })

    // when
    const text = formatFactsStatus("agent-x", state)

    // then
    expect(text).toContain("failure ledger is UNREADABLE")
    expect(text).toContain("unexpected token")
    expect(text).toContain("launches are blocked")
    expect(text).not.toContain("parked: 0")
    expect(text).not.toContain("backoff: 0")
  })

  test("#given failing conversations #when rendering the status view #then counts and bounded per-conversation reasons appear", () => {
    // given
    const many: FactsFailureRecord[] = Array.from({ length: 7 }, (_, index) =>
      parkedRecord({
        conversationId: `conv-${index}`,
        end_message_id: `msg-${index}`,
        lastFailureAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
        lastDetail: `boom ${index}\nsecond line`,
      }),
    )
    const state = overview({ pending: 9, records: [...many, backoffRecord()] })

    // when
    const text = formatFactsStatus("agent-x", state)
    const lines = text.split("\n")

    // then
    expect(text).toContain("queued: 9 pending")
    expect(text).toContain("parked: 7")
    expect(text).toContain("backoff: 1 (next eligible 12m)")
    expect(lines.filter((line) => line.startsWith("- conv-")).length).toBe(5)
    expect(text).toContain("boom 0")
    expect(text).not.toContain("second line")
    expect(text).toContain("/facts retry")
  })

  test("#given a healthy queue #when rendering the status view #then no failure section is shown", () => {
    // given
    const state = overview({ pending: 1 })

    // when
    const text = formatFactsStatus("agent-x", state)

    // then
    expect(text).toContain("queued: 1 pending")
    expect(text).toContain("no failing batches")
    expect(text).not.toContain("parked:")
  })
})

describe("facts remediation hint", () => {
  test("#given parked records #when asking for the hint #then it names /facts retry and the parked count", () => {
    // given
    const state = overview({ records: [parkedRecord(), parkedRecord({ end_message_id: "msg-z" })] })

    // when
    const hint = factsRemediationHint(state)

    // then
    expect(hint).toBe("2 parked facts batches need a manual unpark; run /facts retry after fixing the cause")
  })

  test("#given only backoff records #when asking for the hint #then it reports the wait instead of a remedy", () => {
    // given
    const state = overview({ records: [backoffRecord()] })

    // when
    const hint = factsRemediationHint(state)

    // then
    expect(hint).toBe("1 facts batch is backing off; next attempt in 12m")
  })

  test("#given a clean ledger #when asking for the hint #then there is no hint", () => {
    // given
    const state = overview()

    // when + then
    expect(factsRemediationHint(state)).toBeUndefined()
  })
})
