// The handler the scheduler registry calls when a scheduler of this runtime ends with an error: the
// first failure of a run hands it to recovery; a repeated failure of the same run parks it through the
// one acquisition instead of handing it back again (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import {
  LongRunningTaskManager,
  node,
  pausedRecord,
  runId,
} from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-reservations"
import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import { createSchedulerFailureHandler } from "./dag-scheduler-failure"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function failedSchedulerRun(holder: number) {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-scheduler-failure-handler-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore({ project_dir: directory })
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "failure", name: "failure", nodes: [node("only")] },
    { only: { state: "pending" } },
  )
  const running = { ...paused, status: "running", leaseHolderPid: holder } as DagRunRecordV1
  store.writeCheckpoint(runId, running)
  const taskManager = new LongRunningTaskManager()
  const recovered: string[] = []
  const isProcessAlive = (pid: number): boolean => pid === 101 || pid === 303
  const handler = createSchedulerFailureHandler({
    schedulerOptions: { store, taskManager, hostPid: 101, isProcessAlive, reservations: createDagRunReservations() },
    reservations: createDagRunReservations(),
    probe: { taskManager, hostPid: 101, isProcessAlive },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    holdsRun: () => false,
    children: taskManager,
    closure: { closeHold: async () => undefined },
    recover: async (sessionId) => {
      recovered.push(sessionId)
    },
  })
  return { store, running, handler, recovered, read: () => store.readCheckpoint<DagRunRecordV1>(runId) }
}

describe("DAG scheduler failure handler", () => {
  test("#given a run whose scheduler failed once #when it fails again #then the first failure ran recovery and the second parks the run", async () => {
    const run = failedSchedulerRun(101)
    await run.handler.failed(runId, run.running.parentSessionId, "fault")
    expect(run.recovered).toEqual([run.running.parentSessionId])
    expect(run.read()?.status).toBe("running")

    await run.handler.failed(runId, run.running.parentSessionId, "fault")
    expect(run.recovered).toHaveLength(1)
    expect(run.read()?.status).toBe("paused")
    const events = run.store.readEvents(runId, 0, { limit: 50 }).events
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "dag.run.paused", reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }),
    )
  })

  test("#given a run whose scheduler settled in between #when it fails again #then that is a first failure: recovery, not a park", async () => {
    const run = failedSchedulerRun(101)
    await run.handler.failed(runId, run.running.parentSessionId, "fault")
    run.handler.settled(runId)
    await run.handler.failed(runId, run.running.parentSessionId, "fault")
    expect(run.recovered).toHaveLength(2)
    expect(run.read()?.status).toBe("running")
  })

  test("#given another live process took the run #when this process's second failure would park it #then nothing is written", async () => {
    const run = failedSchedulerRun(303)
    await run.handler.failed(runId, run.running.parentSessionId, "fault")
    await run.handler.failed(runId, run.running.parentSessionId, "fault")
    expect(run.read()?.status).toBe("running")
    expect(run.store.readEvents(runId, 0, { limit: 50 }).events).toEqual([])
  })
})
