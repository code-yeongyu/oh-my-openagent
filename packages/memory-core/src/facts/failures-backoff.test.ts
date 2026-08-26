import { describe, expect, test } from "bun:test"

import {
  applyFailure,
  clearForRetry,
  clearOnSuccess,
  type FactsFailureRecord,
} from "./failures-backoff"

const CONVERSATION = "conversation-alpha"
const T0 = new Date("2026-08-16T00:00:00.000Z")

function target(overrides: Partial<{ conversationId: string; endMessageId: string; endSnapshotLine: number }> = {}) {
  return {
    conversationId: overrides.conversationId ?? CONVERSATION,
    endMessageId: overrides.endMessageId ?? "m2",
    endSnapshotLine: overrides.endSnapshotLine ?? 4,
  }
}

/** Applies `count` distinct failures, one per minute, returning the final record set. */
function streak(count: number, reason: FactsFailureRecord["lastReason"] = "child_exit"): readonly FactsFailureRecord[] {
  let entries: readonly FactsFailureRecord[] = []
  for (let index = 0; index < count; index += 1) {
    entries = applyFailure({
      entries,
      targets: [target()],
      failureId: `run-${index}`,
      reason,
      now: new Date(T0.getTime() + index * 60_000),
    })
  }
  return entries
}

describe("facts failure backoff curve", () => {
  test("#given a first failure #when applyFailure runs #then the entry is eligible one minute later", () => {
    // given / when
    const entries = streak(1)

    // then
    expect(entries).toHaveLength(1)
    expect(entries[0]?.state).toBe("backoff")
    expect(entries[0]?.streak).toBe(1)
    expect(entries[0]?.firstFailureAt).toBe(T0.toISOString())
    expect(entries[0]?.lastFailureAt).toBe(T0.toISOString())
    expect(entries[0]?.nextEligibleAt).toBe(new Date(T0.getTime() + 60_000).toISOString())
    expect(entries[0]?.parkedAt).toBeUndefined()
  })

  test("#given consecutive failures #when the streak grows #then eligibility follows 1m/5m/30m/2h exactly", () => {
    // given
    const offsets = [60_000, 5 * 60_000, 30 * 60_000, 120 * 60_000]

    // when
    const observed = offsets.map((_, index) => streak(index + 1)[0])

    // then
    for (const [index, record] of observed.entries()) {
      const failedAt = T0.getTime() + index * 60_000
      expect(record?.streak).toBe(index + 1)
      expect(record?.state).toBe("backoff")
      expect(record?.nextEligibleAt).toBe(new Date(failedAt + (offsets[index] ?? 0)).toISOString())
    }
  })

  test("#given a fifth consecutive failure #when applyFailure runs #then the entry parks with no eligibility", () => {
    // given / when
    const entries = streak(5)

    // then
    const record = entries[0]
    expect(record?.streak).toBe(5)
    expect(record?.state).toBe("parked")
    expect(record?.nextEligibleAt).toBeNull()
    expect(record?.parkedAt).toBe(new Date(T0.getTime() + 4 * 60_000).toISOString())
    expect(record?.firstFailureAt).toBe(T0.toISOString())
  })

  test("#given a parked entry #when another failure arrives #then it stays parked with a growing streak", () => {
    // given
    const parked = streak(5)

    // when
    const entries = applyFailure({
      entries: parked,
      targets: [target()],
      failureId: "run-later",
      reason: "child_exit",
      now: new Date(T0.getTime() + 10 * 60_000),
    })

    // then
    expect(entries[0]?.state).toBe("parked")
    expect(entries[0]?.streak).toBe(6)
    expect(entries[0]?.nextEligibleAt).toBeNull()
    expect(entries[0]?.parkedAt).toBe(new Date(T0.getTime() + 4 * 60_000).toISOString())
  })

  test("#given a record already parked #when a later different-reason failure lands #then it stays parked with its original parkedAt", () => {
    // given: parked at streak 1 by an oversized entry, far BELOW the streak-5 park threshold,
    // so only `previous.state` can keep it parked.
    const parked = streak(1, "payload_entry_oversize")

    // when
    const entries = applyFailure({
      entries: parked,
      targets: [target()],
      failureId: "run-later",
      reason: "child_exit",
      now: new Date(T0.getTime() + 60 * 60_000),
    })

    // then: parking is absorbing - no reason and no clock can unpark it, only /facts retry.
    expect(entries[0]?.state).toBe("parked")
    expect(entries[0]?.nextEligibleAt).toBeNull()
    expect(entries[0]?.parkedAt).toBe(T0.toISOString())
    expect(entries[0]?.streak).toBe(2)
    expect(entries[0]?.lastReason).toBe("child_exit")
  })

  test("#given a changed failure reason #when the next failure lands #then the streak does not reset", () => {
    // given
    const first = applyFailure({
      entries: [],
      targets: [target()],
      failureId: "run-a",
      reason: "child_exit",
      now: T0,
    })

    // when
    const second = applyFailure({
      entries: first,
      targets: [target()],
      failureId: "run-b",
      reason: "deadline_exceeded",
      now: new Date(T0.getTime() + 60_000),
    })

    // then
    expect(second[0]?.streak).toBe(2)
    expect(second[0]?.lastReason).toBe("deadline_exceeded")
    expect(second[0]?.nextEligibleAt).toBe(new Date(T0.getTime() + 60_000 + 5 * 60_000).toISOString())
  })

  test("#given an oversized single entry #when applyFailure runs once #then it parks immediately at streak 1", () => {
    // given / when
    const entries = streak(1, "payload_entry_oversize")

    // then
    expect(entries[0]?.streak).toBe(1)
    expect(entries[0]?.state).toBe("parked")
    expect(entries[0]?.nextEligibleAt).toBeNull()
    expect(entries[0]?.parkedAt).toBe(T0.toISOString())
  })

  test("#given one failureId already applied #when it is replayed #then the record is unchanged", () => {
    // given
    const first = applyFailure({
      entries: [],
      targets: [target()],
      failureId: "run-a",
      reason: "child_exit",
      now: T0,
    })

    // when
    const replayed = applyFailure({
      entries: first,
      targets: [target()],
      failureId: "run-a",
      reason: "child_exit",
      now: new Date(T0.getTime() + 60_000),
    })

    // then
    expect(replayed).toEqual(first)
  })

  test("#given a detail longer than the cap #when applyFailure runs #then it is truncated to 512 UTF-8 bytes", () => {
    // given
    const detail = "가".repeat(400)

    // when
    const entries = applyFailure({
      entries: [],
      targets: [target()],
      failureId: "run-a",
      reason: "other",
      detail,
      now: T0,
    })

    // then
    const stored = entries[0]?.lastDetail ?? ""
    expect(Buffer.byteLength(stored, "utf8")).toBeLessThanOrEqual(512)
    expect(stored).toBe("가".repeat(170))
  })

  test("#given control characters in the detail #when applyFailure runs #then they are sanitized to spaces", () => {
    // given / when
    const entries = applyFailure({
      entries: [],
      targets: [target()],
      failureId: "run-a",
      reason: "other",
      detail: "child\nexit\u0000code 9",
      now: T0,
    })

    // then
    expect(entries[0]?.lastDetail).toBe("child exit code 9")
  })
})

describe("facts failure clearing", () => {
  test("#given records for two conversations #when clearOnSuccess names one #then only that record is removed", () => {
    // given
    const entries = applyFailure({
      entries: streak(2),
      targets: [target({ conversationId: "conversation-beta", endMessageId: "m9", endSnapshotLine: 12 })],
      failureId: "run-beta",
      reason: "child_exit",
      now: T0,
    })

    // when
    const cleared = clearOnSuccess(entries, [target()])

    // then
    expect(cleared).toHaveLength(1)
    expect(cleared[0]?.conversationId).toBe("conversation-beta")
  })

  test("#given parked records across conversations #when clearForRetry filters one conversation #then the others remain", () => {
    // given
    const entries = applyFailure({
      entries: streak(5),
      targets: [target({ conversationId: "conversation-beta", endMessageId: "m9", endSnapshotLine: 12 })],
      failureId: "run-beta",
      reason: "child_exit",
      now: T0,
    })

    // when
    const cleared = clearForRetry(entries, { conversationId: CONVERSATION })

    // then
    expect(cleared).toHaveLength(1)
    expect(cleared[0]?.conversationId).toBe("conversation-beta")
  })

  test("#given records for two conversations #when clearForRetry has no filter #then every record is cleared", () => {
    // given
    const entries = applyFailure({
      entries: streak(3),
      targets: [target({ conversationId: "conversation-beta", endMessageId: "m9", endSnapshotLine: 12 })],
      failureId: "run-beta",
      reason: "child_exit",
      now: T0,
    })

    // when / then
    expect(clearForRetry(entries, {})).toHaveLength(0)
  })
})
