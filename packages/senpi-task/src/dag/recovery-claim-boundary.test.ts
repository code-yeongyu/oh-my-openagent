// Automatic recovery and the user's Resume take a paused run under different rules: recovery never
// takes a run the user stopped, and Resume takes exactly the Stop it resumes. Each rule must be
// decided on the fresh record under the run lock, because a Stop (or a newer Stop, or a resume
// elsewhere) can land between the entry's read and its claim (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, parentSessionId, pausedRecord, runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
import { createDagRecovery } from "./recovery"
import { createDagFileStore, type DagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST_PID = 101
const DEAD_HOST_PID = 9001
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Change = (record: DagRunRecordV1) => DagRunRecordV1

/** A paused run whose record `change` rewrites the moment the entry first takes the run lock. */
function racedRun(initial: Partial<DagRunRecordV1>, change: Change) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-claim-boundary-"))
  cleanupRoots.push(directory)
  const base = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "claim-boundary", name: "claim boundary", nodes: [node("only")] },
    { only: { state: "completed" } },
  )
  base.writeCheckpoint(runId, { ...paused, previousLeaseHolderPid: DEAD_HOST_PID, ...initial })
  let raced = false
  const store: DagFileStore = {
    ...base,
    withRunLock: (lockedRunId, operation) => {
      if (!raced && lockedRunId === runId) {
        raced = true
        const record = base.readCheckpoint<DagRunRecordV1>(runId)
        if (record !== null) base.writeCheckpoint(runId, change(record))
      }
      return base.withRunLock(lockedRunId, operation)
    },
  }
  const recovery = createDagRecovery({
    store,
    taskManager: new LongRunningTaskManager(),
    hostPid: THIS_HOST_PID,
    isProcessAlive: () => false,
    isRunHeldInProcess: () => false,
  })
  const resumed = () => base.readEvents(runId, 0, { limit: 500 }).events.filter((e) => e.type === "dag.run.resumed")
  return { base, recovery, resumed, raced: () => raced }
}

const userStop =
  (pauseSeq: number): Change =>
  (record) => ({
    ...record,
    status: "paused",
    pause: { reason: "user_stop", pauseSeq },
  })

describe("DAG claims decided on the fresh record under the run lock", () => {
  test("#given a shutdown-paused run #when the user stops it between the automatic sweep's read and its claim #then the sweep leaves it stopped", async () => {
    // given
    const run = racedRun({ status: "paused" }, userStop(5))

    // when
    const outcomes = await run.recovery.installPausedRuns(parentSessionId, () => undefined)

    // then
    expect(run.raced()).toBe(true)
    expect(outcomes).toEqual([])
    expect(run.resumed()).toEqual([])
    expect(run.base.readCheckpoint<DagRunRecordV1>(runId)?.pause).toEqual({ reason: "user_stop", pauseSeq: 5 })
  })

  test("#given a fork source's paused run #when the user stops it between the adopting sweep's read and its claim #then the fork does not adopt it", async () => {
    // given
    const run = racedRun({ status: "paused", parentSessionId: "session-source" }, userStop(5))

    // when
    const outcomes = await run.recovery.installPausedRuns(parentSessionId, () => undefined, "session-source")

    // then
    expect(run.raced()).toBe(true)
    expect(outcomes).toEqual([])
    expect(run.resumed()).toEqual([])
  })

  for (const [landed, change] of [
    ["a newer Stop", userStop(6)],
    ["a resume elsewhere", ((record) => ({ ...record, status: "running" })) as Change],
  ] as const) {
    test(`#given the user's Resume of Stop 5 #when ${landed} lands between its read and its claim #then the Resume is refused`, async () => {
      // given
      const run = racedRun({ status: "paused", pause: { reason: "user_stop", pauseSeq: 5 } }, change)

      // when
      const outcome = await run.recovery.installResumedRun(runId, parentSessionId, 5)

      // then
      expect(run.raced()).toBe(true)
      expect(outcome).toEqual(expect.objectContaining({ kind: "skipped" }))
      expect(run.resumed()).toEqual([])
    })
  }
})
