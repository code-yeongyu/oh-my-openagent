// On Resume the run-pause protocol delivers a stopped run's guidance to its children and records each
// delivery. A guide verb that edits that guidance in the middle of the delivery would see its edit
// lost or delivered stale. The dispatch holds the run's reservation, so the verb is refused as busy
// until the delivery is recorded (#15125).
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
import { guidePausedDag } from "../../../../senpi-task/src/dag/paused-controls"
import { createDagRunReservations, reserveWhenFree } from "../../../../senpi-task/src/dag/run-acquisition"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { createDagRunPauseSource } from "./dag-run-pause-source"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import { within } from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG guidance dispatch holds the run's reservation", () => {
  test("#given the Resume delivering a stopped run's guidance #when a guide verb edits that guidance #then the edit is refused as busy", async () => {
    // given - a user-stopped run with two guidance entries for its paused child; the edit targets the
    // second, which the dispatch has listed but not yet frozen
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-guidance-dispatch-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore({ project_dir: directory })
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "guidance", name: "guidance", nodes: [node("only")] },
      { only: { state: "paused", taskId: "task-only", attempt: 1 } },
    )
    const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 2 } }
    store.writeCheckpoint(runId, stopped)
    const taskManager = new LongRunningTaskManager()
    taskManager.add(taskRecord(owner("only"), "paused", "task-only"))
    const isProcessAlive = (pid: number): boolean => pid === process.pid
    const schedulerOptions = { store, taskManager, isProcessAlive }
    guidePausedDag({ ...schedulerOptions, initialRecord: stopped }, runId, "look again")
    const second = guidePausedDag(
      { ...schedulerOptions, initialRecord: store.readCheckpoint<DagRunRecordV1>(runId) ?? stopped },
      runId,
      "and then this",
    )
    const reservations = createDagRunReservations()
    let openDelivery = (): void => undefined
    const delivery = new Promise<void>((resolve) => (openDelivery = resolve))
    let markDelivering = (): void => undefined
    const delivering = new Promise<void>((resolve) => (markDelivering = resolve))
    const source = createDagRunPauseSource({
      barrier: new AdmissionBarrier(),
      records: () => [store.readCheckpoint<DagRunRecordV1>(runId) ?? stopped],
      options: (record) => ({ ...schedulerOptions, initialRecord: record }),
      retire: async () => undefined,
      prepareResume: () => undefined,
      recovery: createDagRecovery({ store, taskManager, reservations }),
      adopt: () => undefined,
      cancel: async () => undefined,
      reserve: async (id) => (await reserveWhenFree(reservations, id, "guidance dispatch")).release,
      deliverGuidance: async () => {
        markDelivering()
        await delivery
        return {}
      },
    })
    const controls = createDagRuntimeControls({
      coreManager: createDagManager({ store }),
      schedulerOptions,
      schedulers: new Map(),
      reservations,
      holdsRun: () => false,
      sessionId: () => stopped.parentSessionId,
      clearAdmissionLatch: () => undefined,
      adoptReentry: () => undefined,
    })
    const dispatching = source.dispatchGuidance?.(stopped.parentSessionId, 2, "resume-1")
    await within(delivering, "the guidance delivery")

    // when
    const refusal = await within(
      controls.guide(runId, { kind: "edit", id: second.id, text: "changed mid-delivery" }).then(
        () => undefined,
        (error: unknown) => error,
      ),
      "controls.guide",
    )
    openDelivery()
    await within(Promise.resolve(dispatching), "the dispatch")

    // then
    expect(refusal).toEqual(
      expect.objectContaining({ code: "run_busy", message: expect.stringContaining("guidance dispatch") }),
    )
    expect(store.readEvents(runId, 0, { limit: 500 }).events.map((event) => event.type)).not.toContain(
      "dag.guidance.edited",
    )
  })
})
