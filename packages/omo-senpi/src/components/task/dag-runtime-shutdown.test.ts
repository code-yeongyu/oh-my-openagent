// A committed shutdown retires every scheduler of this runtime and then pauses each live run of the
// session. It must hold each of those runs' reservations from before retirement until its pause is
// written: an entry that only waited for the runs to be free and then acted could be overtaken in
// between by any other operation of this process (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagRecovery,
  type DagRunId,
  type DagRunRecordV1,
  type DagScheduler,
} from "@oh-my-opencode/senpi-task/dag"

import { LongRunningTaskManager, node, pausedRecord } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { createDagRunCancel } from "./dag-run-cancel"
import { within } from "./dag-runtime-recovery.test-support"
import { createShutdownPause } from "./dag-runtime-shutdown"
import type { OwnedScheduler } from "./dag-scheduler-registry"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG committed shutdown holds the runs it pauses", () => {
  test("#given a shutdown still retiring one run's scheduler #when a cancel arrives for another live run of the session #then the shutdown pauses that run first and the cancel acts only after it", async () => {
    // given - a run this runtime schedules, and a live run of the session no scheduler here holds
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-shutdown-hold-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore({ project_dir: directory })
    const [held, live] = (["held", "live"] as const).map((id) => {
      const { previousLeaseHolderPid: _previous, ...base } = pausedRecord(
        { key: id, name: id, nodes: [node("only")] },
        { only: { state: "pending" } },
      )
      const record: DagRunRecordV1 = { ...base, runId: `run-${id}` as DagRunId, runKey: id, status: "running" }
      store.writeCheckpoint(record.runId, { ...record, leaseHolderPid: process.pid })
      return record
    }) as [DagRunRecordV1, DagRunRecordV1]
    let openSuspension = (): void => undefined
    const suspension = new Promise<void>((resolve) => (openSuspension = resolve))
    let markRetiring = (): void => undefined
    const retiring = new Promise<void>((resolve) => (markRetiring = resolve))
    const heldScheduler = {
      suspend: async () => {
        markRetiring()
        await suspension
      },
    } as unknown as DagScheduler
    const schedulers = new Map<DagRunId, OwnedScheduler>([
      [held.runId, { scheduler: heldScheduler, running: Promise.resolve(held) }],
    ])
    const reservations = createDagRunReservations()
    const taskManager = new LongRunningTaskManager()
    const isProcessAlive = (pid: number): boolean => pid === process.pid
    const cancelRun = createDagRunCancel({
      store,
      schedulerOptions: { reservations: reservations, store, taskManager, isProcessAlive },
      schedulers,
      reservations,
      holders: { taskManager, hostPid: process.pid, isProcessAlive },
      holdsRun: (id) => schedulers.get(id)?.running !== undefined,
    })
    const shutdown = createShutdownPause({
      sweeps: { close: async () => undefined },
      reservations,
      schedulers,
      recovery: createDagRecovery({ store, taskManager, isProcessAlive, reservations }),
      sessionId: () => live.parentSessionId,
      sessionRuns: () => [held.runId, live.runId],
    })

    // when - the cancel arrives while the shutdown is retiring the held run
    const pausing = shutdown()
    await within(retiring, "the shutdown retiring the held run")
    const cancelling = cancelRun(live.runId, live.parentSessionId)
    openSuspension()
    await within(pausing, "the shutdown")
    await within(cancelling, "the cancel")

    // then
    const types = store.readEvents(live.runId, 0, { limit: 500 }).events.map((event) => event.type)
    expect(types).toContain("dag.run.paused")
    expect(types.indexOf("dag.run.paused")).toBeLessThan(types.indexOf("dag.run.cancelled"))
  })
})
