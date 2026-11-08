import { afterEach, describe, expect, test } from "bun:test"

import { OWNER_STALE_MS } from "./session-summary-storage"
import * as recoveryModule from "./session-summary-recovery"
import { createTempStateDirs, createTestRecorder, rows, summaryTurn } from "./session-summary.test-support"

// The recovery sweep ships as its own bundle (`extensions/omo-telemetry-recovery.js`) so a startup with
// nothing left by a dead process never loads it; these tests count loads through the recorder's loader seam.

const stateDirs = createTempStateDirs()
afterEach(() => stateDirs.cleanup())

const T0 = 1_000_000
const STALE = OWNER_STALE_MS + 1

function countingLoader(fail = false) {
  const loader = {
    loads: 0,
    load: async () => {
      loader.loads += 1
      if (fail) throw new Error("recovery runtime unavailable")
      return recoveryModule
    },
  }
  return loader
}

describe("session_summary lazy recovery", () => {
  test("#given a state dir with nothing to recover #when a session starts, records turns and heartbeats #then the sidecar is never loaded", async () => {
    const dir = stateDirs.make()
    const loader = countingLoader()
    const fresh = createTestRecorder({ dir, startAt: T0, loadRecovery: loader.load })

    await fresh.summary.recover()
    await fresh.summary.recordTurn("s1", summaryTurn())
    fresh.advance(60_000)
    fresh.tick()
    await fresh.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await fresh.summary.recover()

    expect(loader.loads).toBe(0)
    expect(fresh.published).toEqual([])
  })

  test("#given an open window #when the session shuts down #then the sidecar is loaded once for delivery and the window is published once", async () => {
    const dir = stateDirs.make()
    const loader = countingLoader()
    const fresh = createTestRecorder({ dir, startAt: T0, loadRecovery: loader.load })
    await fresh.summary.recordTurn("s1", summaryTurn())
    expect(loader.loads).toBe(0)

    await fresh.summary.finish("s1", "quit")

    expect(loader.loads).toBe(1)
    expect(rows(fresh.published)).toEqual([[0, "shutdown", 1]])
    expect(fresh.storage.pendingUuids()).toEqual([])
  })

  test("#given the sidecar fails to load at a window close #when the window is published #then the event stays pending with a capture diagnostic and the next process sends it", async () => {
    const dir = stateDirs.make()
    const broken = countingLoader(true)
    const closing = createTestRecorder({ dir, startAt: T0, loadRecovery: broken.load })
    await closing.summary.recordTurn("s1", summaryTurn())
    await closing.summary.finish("s1", "quit")

    expect(broken.loads).toBe(1)
    expect(closing.published).toEqual([])
    expect(closing.diagnostics.map(({ event }) => event)).toEqual(["telemetry_capture_failed"])
    expect(closing.storage.pendingUuids()).toHaveLength(1)

    // when: a later process (the closing one is gone) sweeps
    const next = createTestRecorder({ dir, pid: 959_595, startAt: T0 + STALE })
    await next.summary.recover()

    // then
    expect(rows(next.published)).toEqual([[0, "shutdown", 1]])
    expect(next.storage.pendingUuids()).toEqual([])
  })

  test("#given a window another process wrote after this one's startup sweep #when this process records that session #then it loads the liveness check first and continues the dead owner's window", async () => {
    const dir = stateDirs.make()
    const loader = countingLoader()
    const next = createTestRecorder({ dir, pid: 969_696, startAt: T0, loadRecovery: loader.load })
    await next.summary.recordTurn("s2", summaryTurn())
    expect(loader.loads).toBe(0)

    const dead = createTestRecorder({ dir, pid: 979_797, startAt: T0 })
    await dead.summary.recordTurn("s1", summaryTurn({ totalTokens: 9 }))

    // when
    await next.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await next.summary.finish("s1", "quit")

    // then
    expect(loader.loads).toBe(1)
    expect(rows(next.published)).toEqual([[0, "shutdown", 2]])
  })

  test("#given a dead owner's abandoned window #when the next process starts #then it loads the recovery module once and recovers the window", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 919_191, startAt: T0 })
    await dead.summary.recordTurn("orphan", summaryTurn({ totalTokens: 9 }))

    const loader = countingLoader()
    const next = createTestRecorder({ dir, pid: 929_292, startAt: T0 + STALE, loadRecovery: loader.load })
    await next.summary.recover()
    await next.summary.recordTurn("s2", summaryTurn())
    next.tick()

    expect(loader.loads).toBe(1)
    expect(rows(next.published)).toEqual([[0, "recovered", 1]])
    expect(next.published[0]?.properties).toMatchObject({ $session_id: "orphan", total_tokens: 9 })
  })

  test("#given the recovery module fails to load #when recovery is needed #then the failure is a state diagnostic and a later sweep loads it again", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 939_393, startAt: T0 })
    await dead.summary.recordTurn("orphan", summaryTurn())

    const broken = countingLoader(true)
    const next = createTestRecorder({ dir, pid: 949_494, startAt: T0 + STALE, loadRecovery: broken.load })
    await next.summary.recover()
    await next.summary.recover()

    expect(broken.loads).toBe(2)
    expect(next.published).toEqual([])
    expect(next.diagnostics.map(({ event }) => event)).toEqual(["telemetry_activity_state_write_failed", "telemetry_activity_state_write_failed"])
  })
})
