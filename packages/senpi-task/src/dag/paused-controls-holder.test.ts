// Every write to a user-stopped run is decided at the write by both facts on the fresh record: still
// stopped by the same Stop, and not held by another live process. A successor that claims the run for
// an explicit Resume writes its lease while the record still reads the same Stop (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, pausedRecord, runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
import { retryDagNodes } from "./node-retry"
import { applyPausedDagGuidance, cancelPausedDagNode, guidePausedDag } from "./paused-controls"
import type { DagSchedulerOptions } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST = 101
const LIVE_HOST = 303
const DEAD_HOST = 9_999_999
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Write = (options: DagSchedulerOptions, guidanceId: string) => unknown

const cancelOpen: Write = (options) =>
  cancelPausedDagNode(options, runId, "open" as DagNodeId, { closeHold: async () => undefined })

// [write, the run lock (1-based) its own append starts at, events it wrote before that append]. One
// journal append takes the run lock twice, so the cancel-node transition's append starts at the third.
const writes: ReadonlyArray<readonly [string, Write, number, number]> = [
  ["guide add", (options) => guidePausedDag(options, runId, "more"), 1, 0],
  ["guide edit", (options, id) => applyPausedDagGuidance(options, runId, { kind: "edit", id, text: "x" }), 1, 0],
  ["guide remove", (options, id) => applyPausedDagGuidance(options, runId, { kind: "remove", id }), 1, 0],
  ["cancel-node request", cancelOpen, 1, 0],
  ["cancel-node transition", cancelOpen, 3, 1],
  ["retry staging", (options) => retryDagNodes(options, runId, ["broken" as DagNodeId]), 1, 0],
]

/** A user-stopped run whose `lease` lands inside the write's `atLock`-th run lock, status and Stop unchanged. */
function stoppedRun(lease: number, atLock: number) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-stopped-holder-"))
  cleanupRoots.push(directory)
  const base = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "stopped-holder", name: "stopped holder", nodes: [node("open"), node("broken")] },
    { open: { state: "pending" }, broken: { state: "failed" } },
  )
  const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 2 } }
  base.writeCheckpoint(runId, stopped)
  const plain = { store: base, taskManager: new LongRunningTaskManager(), hostPid: THIS_HOST, initialRecord: stopped }
  const guidance = guidePausedDag({ ...plain, isProcessAlive: () => false }, runId, "first")
  const eventsBefore = base.readEvents(runId, 0, { limit: 500 }).events.length
  let locks = 0
  const store: DagFileStore = {
    ...base,
    withRunLock: (lockedRunId, operation) => {
      if (lockedRunId === runId && ++locks === atLock) {
        const record = base.readCheckpoint<DagRunRecordV1>(runId)
        if (record !== null) base.writeCheckpoint(runId, { ...record, leaseHolderPid: lease } as DagRunRecordV1)
      }
      return base.withRunLock(lockedRunId, operation)
    },
  }
  const current = base.readCheckpoint<DagRunRecordV1>(runId) ?? stopped
  const options: DagSchedulerOptions = {
    ...plain,
    store,
    initialRecord: current,
    isProcessAlive: (pid) => pid === LIVE_HOST || pid === THIS_HOST,
  }
  const newEvents = () => base.readEvents(runId, 0, { limit: 500 }).events.length - eventsBefore
  return { options, guidanceId: guidance.id, newEvents }
}

const outcomeOf = async (operation: () => unknown): Promise<unknown> => {
  try {
    await operation()
    return undefined
  } catch (error) {
    return error
  }
}

describe("DAG writes to a user-stopped run under the one holder rule", () => {
  for (const [name, write, atLock, prior] of writes) {
    test(`#given a live process claims the stopped run at the ${name} write #when it writes #then run_not_owned and nothing is appended by it`, async () => {
      // given
      const run = stoppedRun(LIVE_HOST, atLock)

      // when
      const refusal = await outcomeOf(() => write(run.options, run.guidanceId))

      // then
      expect(refusal).toEqual(
        expect.objectContaining({ code: "run_not_owned", message: expect.stringContaining(String(LIVE_HOST)) }),
      )
      expect(run.newEvents()).toBe(prior)
    })

    for (const [whose, lease] of [
      ["a dead process", DEAD_HOST],
      ["this host", THIS_HOST],
    ] as const) {
      test(`#given ${whose}'s lease on the stopped run at the ${name} write #when it writes #then it is not refused`, async () => {
        // given
        const run = stoppedRun(lease, atLock)

        // when
        const outcome = await outcomeOf(() => write(run.options, run.guidanceId))

        // then
        expect(outcome).toBeUndefined()
        expect(run.newEvents()).toBeGreaterThan(prior)
      })
    }
  }
})
