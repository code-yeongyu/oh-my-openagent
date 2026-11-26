// A control verb on a run this host does not hold must not build a scheduler: one that never runs or
// suspends keeps its journal subscription until the run reaches a terminal status, so refused verbs
// against a parked or foreign-held run piled up stale contexts that refreshed on every later commit
// (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagJournal,
  createDagManager,
  type DagRunRecordV1,
  type DagScheduler,
} from "@oh-my-opencode/senpi-task/dag"

import {
  LongRunningTaskManager,
  node,
  owner,
  pausedRecord,
  runId,
  taskRecord,
} from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { applyDagSchedulerEvent, observeDagSchedulers } from "../../../../senpi-task/src/dag/scheduler"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import { FOREIGN_HOST_PID } from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG runtime control verbs on a run this host does not hold", () => {
  test("#given a parked run another live process holds #when retries and sends are refused again and again #then no scheduler was built, so none refreshes on a later commit", async () => {
    // given - parked with its node active, the lease held by a live foreign process
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-controls-carrier-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore({ project_dir: directory })
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "carrier", name: "carrier", nodes: [node("slow")] },
      { slow: { state: "running", taskId: "task-slow", attempt: 1 } },
    )
    const parked: DagRunRecordV1 = { ...paused, leaseHolderPid: FOREIGN_HOST_PID }
    store.writeCheckpoint(runId, parked)
    const taskManager = new LongRunningTaskManager()
    taskManager.add(taskRecord(owner("slow"), "running", "task-slow"))
    const built: DagScheduler[] = []
    const stopObserving = observeDagSchedulers(taskManager, (scheduler) => built.push(scheduler))
    const controls = createDagRuntimeControls({
      coreManager: createDagManager({ store }),
      schedulerOptions: {
        reservations: createDagRunReservations(),
        store,
        taskManager,
        isProcessAlive: (pid) => pid === FOREIGN_HOST_PID,
      },
      schedulers: new Map(),
      reservations: createDagRunReservations(),
      holdsRun: () => false,
      sessionId: () => parked.parentSessionId,
      clearAdmissionLatch: () => undefined,
      adoptReentry: () => {
        throw new Error("a refused verb must not adopt a scheduler")
      },
    })

    // when
    for (let round = 0; round < 3; round += 1) {
      await expect(controls.retry(runId)).rejects.toThrow()
      await expect(controls.send(runId, "slow", "steer")).rejects.toThrow()
    }
    const seqBefore = store.readCheckpoint<DagRunRecordV1>(runId)?.checkpointSeq ?? 0
    createDagJournal<DagRunRecordV1>({
      store,
      runId,
      initialCheckpoint: parked,
      applyEvent: (record, event) => applyDagSchedulerEvent(record, event),
    }).append({ type: "dag.wave.started", waveIndex: 0, nodeIds: [] })
    await Promise.resolve()
    stopObserving()

    // then
    expect(built).toHaveLength(0)
    for (const scheduler of built) expect(scheduler.snapshot().checkpointSeq).toBe(seqBefore)
  })
})
