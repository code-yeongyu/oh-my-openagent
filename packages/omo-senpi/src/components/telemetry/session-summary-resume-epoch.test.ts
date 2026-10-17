import { afterEach, describe, expect, test } from "bun:test"

import { OWNER_STALE_MS } from "./session-summary-storage"
import { createTempStateDirs, createTestRecorder, summaryKeys, summaryTurn } from "./session-summary.test-support"

// The collector deduplicates session_summary rows on (session, summary_epoch, summary_seq). Liveness can be wrong
// (a hung owner, a platform without a start time), so a process that continues or recovers another process's
// window must never publish a pair that process may still publish: every hand-over starts a new epoch.

const stateDirs = createTempStateDirs()
afterEach(() => stateDirs.cleanup())

const T0 = 1_000_000
const STALE = OWNER_STALE_MS + 1

describe("session_summary epoch on hand-over", () => {
  test("#given a live owner misjudged as dead #when another process resumes and continues its open window #then the two publish strictly distinct (epoch, seq) pairs", async () => {
    const dir = stateDirs.make()
    const owner = createTestRecorder({ dir, pid: 111, startAt: T0 })
    await owner.summary.recordTurn("s1", summaryTurn())

    // when: pid 111 reads as dead to the resumer, which continues the window (its heartbeat is too fresh for a sweep)
    const resumer = createTestRecorder({ dir, pid: 222, startAt: T0 + 1_000 })
    await resumer.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await resumer.summary.finish("s1", "quit")
    await owner.summary.finish("s1", "quit")

    // then
    const ownerKeys = summaryKeys(owner.published)
    const resumedKeys = summaryKeys(resumer.published)
    expect(ownerKeys).toHaveLength(1)
    expect(resumedKeys).toHaveLength(1)
    expect(resumedKeys.filter((key) => ownerKeys.includes(key))).toEqual([])
  })

  test("#given a live owner misjudged as dead #when a sweep recovers its open window #then the recovered row and the owner's own row carry distinct (epoch, seq) pairs", async () => {
    const dir = stateDirs.make()
    const owner = createTestRecorder({ dir, pid: 111, startAt: T0 })
    await owner.summary.recordTurn("s1", summaryTurn())

    // when
    const sweeper = createTestRecorder({ dir, pid: 333, startAt: T0 + STALE })
    await sweeper.summary.recover()
    await owner.summary.finish("s1", "quit")

    // then
    const recovered = summaryKeys(sweeper.published)
    expect(recovered).toHaveLength(1)
    expect(summaryKeys(owner.published).filter((key) => recovered.includes(key))).toEqual([])
  })
})
