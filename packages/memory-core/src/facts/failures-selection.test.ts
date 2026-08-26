import { describe, expect, test } from "bun:test"

import {
  factsSelectionKey,
  selectLaunchable,
  type FactsLaunchSelection,
} from "./failures-selection"
import type { FactsFailureRecord, FactsFailuresFile } from "./failures-schema"
import { FACTS_QUEUE_VERSION, type FactsQueueEntry } from "./schema"

const T0 = new Date("2026-08-16T00:00:00.000Z")

function entry(conversationId: string, endMessageId: string, endSnapshotLine: number): FactsQueueEntry {
  return {
    version: FACTS_QUEUE_VERSION,
    identity: "agent",
    sessionId: conversationId,
    conversationId,
    range: {
      start_message_id: `${endMessageId}-start`,
      end_message_id: endMessageId,
      start_line: Math.max(endSnapshotLine - 1, 0),
      end_snapshot_line: endSnapshotLine,
    },
    enqueuedAt: T0.toISOString(),
    entries: [],
  }
}

function parked(conversationId: string, endMessageId: string, endSnapshotLine: number): FactsFailureRecord {
  return {
    conversationId,
    end_message_id: endMessageId,
    end_snapshot_line: endSnapshotLine,
    state: "parked",
    streak: 5,
    firstFailureAt: T0.toISOString(),
    lastFailureAt: T0.toISOString(),
    lastReason: "child_exit",
    lastFailureId: "run-parked",
    nextEligibleAt: null,
    parkedAt: T0.toISOString(),
  }
}

function backoff(
  conversationId: string,
  endMessageId: string,
  endSnapshotLine: number,
  nextEligibleAt: Date,
): FactsFailureRecord {
  return {
    conversationId,
    end_message_id: endMessageId,
    end_snapshot_line: endSnapshotLine,
    state: "backoff",
    streak: 1,
    firstFailureAt: T0.toISOString(),
    lastFailureAt: T0.toISOString(),
    lastReason: "child_exit",
    lastFailureId: "run-backoff",
    nextEligibleAt: nextEligibleAt.toISOString(),
  }
}

function failures(records: readonly FactsFailureRecord[]): FactsFailuresFile {
  return { version: 1, updatedAt: T0.toISOString(), entries: records }
}

function endpoints(selection: FactsLaunchSelection): readonly string[] {
  return selection.selected.map((selected) => `${selected.conversationId}/${selected.range.end_message_id}`)
}

describe("facts launch selection", () => {
  test("#given no failures file #when selecting #then every pending entry is launchable", () => {
    // given
    const entries = [entry("alpha", "m1", 1), entry("beta", "m9", 3)]

    // when
    const selection = selectLaunchable(entries, undefined, T0)

    // then
    expect(endpoints(selection)).toEqual(["alpha/m1", "beta/m9"])
    expect(selection.skipped).toEqual({})
  })

  test("#given a parked endpoint #when selecting #then its later same-conversation entries are blocked but other conversations flow", () => {
    // given
    const entries = [
      entry("alpha", "m1", 1),
      entry("alpha", "m2", 4),
      entry("beta", "m9", 2),
    ]

    // when
    const selection = selectLaunchable(entries, failures([parked("alpha", "m1", 1)]), T0)

    // then
    expect(endpoints(selection)).toEqual(["beta/m9"])
    expect(selection.skipped).toEqual({
      [factsSelectionKey("alpha", "m1")]: "parked",
      [factsSelectionKey("alpha", "m2")]: "blocked-by-predecessor",
    })
  })

  test("#given a backoff endpoint #when the clock is one millisecond early #then it is dropped", () => {
    // given
    const eligibleAt = new Date(T0.getTime() + 60_000)
    const entries = [entry("alpha", "m1", 1)]

    // when
    const selection = selectLaunchable(
      entries,
      failures([backoff("alpha", "m1", 1, eligibleAt)]),
      new Date(eligibleAt.getTime() - 1),
    )

    // then
    expect(selection.selected).toEqual([])
    expect(selection.skipped).toEqual({ [factsSelectionKey("alpha", "m1")]: "backoff" })
  })

  test("#given a backoff endpoint #when the clock reaches nextEligibleAt exactly #then it is launchable", () => {
    // given
    const eligibleAt = new Date(T0.getTime() + 60_000)
    const entries = [entry("alpha", "m1", 1)]

    // when
    const selection = selectLaunchable(entries, failures([backoff("alpha", "m1", 1, eligibleAt)]), eligibleAt)

    // then
    expect(endpoints(selection)).toEqual(["alpha/m1"])
    expect(selection.skipped).toEqual({})
  })

  test("#given a legacy record anchored at snapshot line 0 #when its entry carries a real boundary #then the pair still gates", () => {
    // given: legacy ledgers carry no snapshot boundary, so their records anchor at 0. Keying on
    // the full triple would make the record invisible and silently relaunch a parked batch.
    const entries = [entry("alpha", "m1", 7), entry("alpha", "m2", 9)]

    // when
    const selection = selectLaunchable(entries, failures([parked("alpha", "m1", 0)]), T0)

    // then
    expect(selection.selected).toEqual([])
    expect(selection.skipped).toEqual({
      [factsSelectionKey("alpha", "m1")]: "parked",
      [factsSelectionKey("alpha", "m2")]: "blocked-by-predecessor",
    })
  })

  test("#given an unrelated failure record #when selecting #then entries with no record of their own stay launchable", () => {
    // given
    const entries = [entry("alpha", "m1", 1)]

    // when
    const selection = selectLaunchable(entries, failures([parked("beta", "m9", 2)]), T0)

    // then
    expect(endpoints(selection)).toEqual(["alpha/m1"])
    expect(selection.skipped).toEqual({})
  })

  test("#given an out-of-order pending list #when a dropped entry has a lower snapshot boundary #then gating follows the boundary, not the list order", () => {
    // given: the successor is listed first; prefix gating is defined by the snapshot boundary.
    const entries = [entry("alpha", "m2", 6), entry("alpha", "m1", 2)]

    // when
    const selection = selectLaunchable(entries, failures([parked("alpha", "m1", 2)]), T0)

    // then
    expect(selection.selected).toEqual([])
    expect(selection.skipped).toEqual({
      [factsSelectionKey("alpha", "m1")]: "parked",
      [factsSelectionKey("alpha", "m2")]: "blocked-by-predecessor",
    })
  })

  test("#given a launchable predecessor #when a later entry is parked #then the predecessor still launches", () => {
    // given
    const entries = [entry("alpha", "m1", 1), entry("alpha", "m2", 4)]

    // when
    const selection = selectLaunchable(entries, failures([parked("alpha", "m2", 4)]), T0)

    // then
    expect(endpoints(selection)).toEqual(["alpha/m1"])
    expect(selection.skipped).toEqual({ [factsSelectionKey("alpha", "m2")]: "parked" })
  })
})
