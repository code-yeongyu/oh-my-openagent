// The user-stopped-run controls (guide, cancel a node) check that the run is stopped by the user, then
// write. A Resume can land between that read and the write; the write must decide again, on the
// fresh record under the run lock, that the run is still stopped by the same Stop (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, pausedRecord, runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
import { cancelPausedDagNode, guidePausedDag } from "./paused-controls"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function stoppedRunResumedAtTheLock() {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-paused-controls-boundary-"))
  cleanupRoots.push(directory)
  const base = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "paused-controls", name: "paused controls", nodes: [node("only")] },
    { only: { state: "pending" } },
  )
  const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 2 } }
  base.writeCheckpoint(runId, stopped)
  let raced = false
  const store: DagFileStore = {
    ...base,
    withRunLock: (lockedRunId, operation) => {
      if (!raced && lockedRunId === runId) {
        raced = true
        const { pause: _pause, ...resumed } = stopped
        base.writeCheckpoint(runId, { ...resumed, status: "running" })
      }
      return base.withRunLock(lockedRunId, operation)
    },
  }
  const options = { store, taskManager: new LongRunningTaskManager(), initialRecord: stopped }
  const events = () => base.readEvents(runId, 0, { limit: 500 }).events
  return { options, events, raced: () => raced }
}

describe("DAG user-stopped-run controls decided on the fresh record", () => {
  test("#given a user-stopped run #when it is resumed between a guide's read and its write #then no guidance is recorded and the guide is refused", () => {
    // given
    const run = stoppedRunResumedAtTheLock()

    // when
    let refusal: unknown
    try {
      guidePausedDag(run.options, runId, "look again")
    } catch (error) {
      refusal = error
    }

    // then
    expect(run.raced()).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_user_paused" }))
    expect(run.events()).toEqual([])
  })

  test("#given a user-stopped run #when it is resumed between a node cancel's read and its write #then no cancel is requested and the cancel is refused", async () => {
    // given
    const run = stoppedRunResumedAtTheLock()

    // when
    const refusal = await cancelPausedDagNode(run.options, runId, "only" as DagNodeId, {
      closeHold: async () => undefined,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect(run.raced()).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_user_paused" }))
    expect(run.events()).toEqual([])
  })
})
