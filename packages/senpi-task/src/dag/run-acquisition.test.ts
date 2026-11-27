// The acquisition creates its own per-run reservation before it writes the lease. If that write
// fails, the caller never receives the reservation, so the acquisition itself must release it, or
// every later cancel and shutdown of this process waits on the run forever (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, pausedRecord, runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
import { acquireDagRun, createDagRunReservations, dagRunEligibility } from "./run-acquisition"
import { createDagFileStore, type DagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG run acquisition when its lease write fails", () => {
  test("#given a lease write that fails once #when the run is acquired #then the acquisition throws, its own reservation is released, and a second acquisition succeeds", () => {
    // given
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-acquire-fault-"))
    cleanupRoots.push(directory)
    const base = createDagFileStore(ownedTaskState(directory))
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "acquire-fault", name: "acquire fault", nodes: [node("only")] },
      { only: { state: "pending" } },
    )
    base.writeCheckpoint(runId, { ...paused, status: "pending" })
    let failNextWrite = true
    const store: DagFileStore = {
      ...base,
      writeCheckpoint: (id, checkpoint) => {
        if (failNextWrite) {
          failNextWrite = false
          throw new Error("disk I/O failure")
        }
        base.writeCheckpoint(id, checkpoint)
      },
    }
    const reservations = createDagRunReservations()
    const request = {
      operation: "start",
      probe: { taskManager: new LongRunningTaskManager(), hostPid: 101, isProcessAlive: () => false },
      reservations,
      eligible: dagRunEligibility.freshStart(paused.parentSessionId),
    }

    // when
    expect(() => acquireDagRun<DagRunRecordV1>(store, runId, request)).toThrow("disk I/O failure")

    // then
    expect(reservations.inFlight(runId)).toBeUndefined()
    const second = acquireDagRun<DagRunRecordV1>(store, runId, request)
    expect(second.kind).toBe("acquired")
    if (second.kind === "acquired") second.reservation?.release()
  })
})
