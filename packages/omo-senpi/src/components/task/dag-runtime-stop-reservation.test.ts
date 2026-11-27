// A user Stop retires this host's schedulers, then journals the pause. Unless the Stop holds each
// run's reservation through both, a verb of this process can take the run in between (here: a retry
// re-entering a settled run while another run's scheduler is still retiring), and the Stop's pause
// then lands on a run whose new scheduler keeps running (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagManager,
  createDagRecovery,
  type DagRunId,
  type DagRunRecordV1,
  type DagScheduler,
} from "@oh-my-opencode/senpi-task/dag"

import { LongRunningTaskManager, node, pausedRecord } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { createDagRunPauseSource } from "./dag-run-pause-source"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import { within } from "./dag-runtime-recovery.test-support"
import { createStopRetirement } from "./dag-runtime-pause-wiring"
import type { OwnedScheduler } from "./dag-scheduler-registry"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG user Stop holds each run's reservation", () => {
  test("#given a Stop still retiring one run's scheduler #when a retry tries to re-enter another run of the session #then the retry is refused as busy and the Stop pauses that run with no scheduler left on it", async () => {
    // given - a running run this host schedules, and a run of the same session this host paused for
    // shutdown with its node failed (re-enterable, and one the Stop will pause)
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-stop-reservation-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore({ project_dir: directory })
    const runs = (["held", "failed"] as const).map((id) => {
      const { previousLeaseHolderPid: _previous, ...base } = pausedRecord(
        { key: id, name: id, nodes: [node("only")] },
        { only: { state: id === "held" ? "running" : "failed" } },
      )
      const status = id === "held" ? ("running" as const) : ("paused" as const)
      const record: DagRunRecordV1 = { ...base, runId: `run-${id}` as DagRunId, runKey: id, status }
      store.writeCheckpoint(record.runId, { ...record, ...(id === "held" ? { leaseHolderPid: process.pid } : {}) })
      return record
    })
    const [held, failed] = runs as [DagRunRecordV1, DagRunRecordV1]
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
    const controls = createDagRuntimeControls({
      coreManager: createDagManager({ store }),
      schedulerOptions: { reservations: reservations, store, taskManager, isProcessAlive },
      schedulers,
      reservations,
      holdsRun: (id) => schedulers.get(id)?.running !== undefined,
      sessionId: () => failed.parentSessionId,
      clearAdmissionLatch: () => undefined,
      adoptReentry: (id, reentry) => {
        schedulers.set(id, { scheduler: reentry.scheduler, running: reentry.run })
      },
    })
    const source = createDagRunPauseSource({
      barrier: new AdmissionBarrier(),
      records: () => runs.map((run) => store.readCheckpoint<DagRunRecordV1>(run.runId) ?? run),
      options: (record) => ({ reservations: reservations, store, taskManager, isProcessAlive, initialRecord: record }),
      retire: createStopRetirement({ schedulers, reservations, stoppedAdmissions: new Set() }),
      prepareResume: () => undefined,
      recovery: createDagRecovery({ store, taskManager }),
      adopt: () => undefined,
      cancel: async () => undefined,
    })

    // when - the Stop is retiring the held run when the retry arrives
    const stopping = source.quiesce?.(failed.parentSessionId, 3)
    await within(retiring, "the Stop retiring the held run")
    const refusal = await within(
      controls.retry(failed.runId).then(
        () => undefined,
        (error: unknown) => error,
      ),
      "controls.retry",
    )
    openSuspension()
    await within(Promise.resolve(stopping), "the Stop")

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_busy", message: expect.stringContaining("stop") }))
    expect(schedulers.has(failed.runId)).toBe(false)
    expect(store.readCheckpoint<DagRunRecordV1>(failed.runId)?.pause).toEqual({ reason: "user_stop", pauseSeq: 3 })
    expect(store.readEvents(failed.runId, 0, { limit: 500 }).events.map((event) => event.type)).not.toContain(
      "dag.run.resumed",
    )
  })
})
