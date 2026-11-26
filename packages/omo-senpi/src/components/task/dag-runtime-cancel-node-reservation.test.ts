// Cancelling a node of a user-stopped run ends its child and journals the node cancelled. The user's
// Resume of that run claims it and restores its paused children; a node cancel in that window would
// race the Resume over the same child. Like every other verb it takes the run's reservation, and a
// run being resumed refuses it as busy (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagManager,
  createDagRecovery,
  type DagRunRecordV1,
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
import { createDagRuntimeControls } from "./dag-runtime-controls"
import { within } from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG node cancel while the user's Resume installs the run", () => {
  test("#given a Resume still restoring a stopped run's children #when a node of that run is cancelled #then the cancel is refused as busy and nothing is journaled by it", async () => {
    // given - a user-stopped run whose paused node child the Resume restores
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-cancel-node-reservation-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore({ project_dir: directory })
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "cancel-node", name: "cancel node", nodes: [node("only")] },
      { only: { state: "paused", taskId: "task-only", attempt: 1 } },
    )
    const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 2 } }
    store.writeCheckpoint(runId, stopped)
    const taskManager = new LongRunningTaskManager()
    taskManager.add(taskRecord(owner("only"), "paused", "task-only"))
    let openRestore = (): void => undefined
    const restore = new Promise<void>((resolve) => (openRestore = resolve))
    let markRestoring = (): void => undefined
    const restoring = new Promise<void>((resolve) => (markRestoring = resolve))
    const reservations = createDagRunReservations()
    const isProcessAlive = (pid: number): boolean => pid === process.pid
    const recovery = createDagRecovery({
      store,
      taskManager,
      isProcessAlive,
      isRunHeldInProcess: () => false,
      reservations,
      pausedChildren: {
        inspect: () => "restorable",
        restorePaused: async () => {
          markRestoring()
          await restore
          return { childSeq: 1 }
        },
      },
    })
    const controls = createDagRuntimeControls({
      coreManager: createDagManager({ store }),
      schedulerOptions: { reservations: reservations, store, taskManager, isProcessAlive },
      schedulers: new Map(),
      reservations,
      holdsRun: () => false,
      sessionId: () => stopped.parentSessionId,
      clearAdmissionLatch: () => undefined,
      adoptReentry: () => undefined,
      closure: { closeHold: async () => undefined },
    })
    const resuming = recovery.installResumedRun(runId, stopped.parentSessionId, 2)
    await within(restoring, "the Resume restoring the paused child")
    const eventsBefore = store.readEvents(runId, 0, { limit: 500 }).events.length

    // when
    const refusal = await within(
      controls.cancelNode(runId, "only").then(
        () => undefined,
        (error: unknown) => error,
      ),
      "controls.cancelNode",
    )

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_busy", message: expect.stringContaining("resume") }))
    expect(store.readEvents(runId, 0, { limit: 500 }).events.length).toBe(eventsBefore)
    openRestore()
    const installed = await within(resuming, "the Resume")
    if (installed.kind === "installed") installed.release()
  })
})
