// An amend of a run this host paused takes the run's lease before it writes the amendment, and only
// adopts its re-entry scheduler after the amendment returns. A recovery sweep in that window reads the
// lease as this host's own with no scheduler here, and would claim and install the run beside the
// amend's re-entry. The amend's in-process reservation must keep recovery off the run (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagManager,
  createDagRecovery,
  type DagManager,
  type DagRunId,
  type DagRunRecordV1,
  type InstalledDagRun,
} from "@oh-my-opencode/senpi-task/dag"

import { LongRunningTaskManager, node } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import { within } from "./dag-runtime-recovery.test-support"
import type { OwnedScheduler } from "./dag-scheduler-registry"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const definition = (prompt: string) => ({
  key: "amend-overlap",
  name: "amend overlap",
  nodes: [{ ...node("only"), prompt }],
})

describe("DAG runtime amend overlapping a recovery sweep", () => {
  test("#given an amend of a run this host paused, still writing its amendment #when a recovery sweep runs #then recovery leaves the run to the amend, which re-enters it once", async () => {
    // given - a run this host paused for shutdown between nodes, its node failed
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-amend-overlap-"))
    cleanupRoots.push(directory)
    const sessionId = "session-parent"
    const store = createDagFileStore({ project_dir: directory })
    const coreManager = createDagManager({ store })
    const started = await coreManager.start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: definition("first"),
    })
    const runId = started.snapshot.runId
    const record = store.readCheckpoint<DagRunRecordV1>(runId)
    if (record === null) throw new Error("expected a checkpoint")
    const nodes = record.nodes.map((entry) => ({ ...entry, state: "failed" as const }))
    store.writeCheckpoint(runId, { ...record, nodes, status: "paused", previousLeaseHolderPid: process.pid })

    // The amendment itself waits at a gate, so the sweep runs while the amend is in flight.
    let openGate = (): void => undefined
    const gate = new Promise<void>((resolve) => (openGate = resolve))
    let markEntered = (): void => undefined
    const entered = new Promise<void>((resolve) => (markEntered = resolve))
    const gatedManager: DagManager = {
      ...coreManager,
      amend: async (params) => {
        markEntered()
        await gate
        return coreManager.amend(params)
      },
    }
    const taskManager = new LongRunningTaskManager()
    const schedulers = new Map<DagRunId, OwnedScheduler>()
    const holdsRun = (id: DagRunId): boolean => schedulers.get(id)?.running !== undefined
    const reservations = createDagRunReservations()
    const isProcessAlive = (pid: number): boolean => pid === process.pid
    const controls = createDagRuntimeControls({
      coreManager: gatedManager,
      schedulerOptions: { reservations: reservations, store, taskManager, isProcessAlive },
      schedulers,
      holdsRun,
      reservations,
      sessionId: () => sessionId,
      clearAdmissionLatch: () => undefined,
      adoptReentry: (id, reentry) => {
        schedulers.set(id, { scheduler: reentry.scheduler, running: reentry.run })
      },
    })
    const recovery = createDagRecovery({
      store,
      taskManager,
      isProcessAlive,
      isRunHeldInProcess: holdsRun,
      reservations,
    })
    const amending = controls.amend(runId, definition("second"))
    await within(entered, "the amendment reaching its write")

    // when
    const installed: InstalledDagRun[] = []
    const outcomes = await within(
      recovery.installPausedRuns(sessionId, (run) => installed.push(run)),
      "the sweep",
    )

    // then - recovery left the run to the amend
    expect(installed).toEqual([])
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: process.pid }])

    // and when the amendment lands, its re-entry is the only scheduler that ran the node
    openGate()
    await within(amending, "the amend")
    await within(schedulers.get(runId)?.running ?? Promise.reject(new Error("no re-entry")), "the re-entered run")
    const resumed = store
      .readEvents(runId, 0, { limit: 500 })
      .events.filter((event) => event.type === "dag.run.resumed")
    expect(resumed).toHaveLength(0)
    expect(taskManager.startOwnedCalls).toEqual(["only"])
  })
})
