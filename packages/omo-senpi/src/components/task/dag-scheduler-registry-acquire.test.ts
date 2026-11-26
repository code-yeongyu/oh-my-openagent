// ensureScheduled decides a run is `pending`, then takes it. Another host can finish, cancel or park
// the run in between, and a scheduler built over that changed record appends a second completion or
// admits work under a paused run. The decision belongs on the fresh record inside the acquisition
// lock, and the scheduler is built from exactly the record acquired (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDagFileStore,
  createDagManager,
  type DagFileStore,
  type DagRunId,
  type DagRunRecordV1,
} from "@oh-my-opencode/senpi-task/dag"

import { LongRunningTaskManager } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { dagNode } from "./dag-runtime-recovery.test-support"
import { createDagSchedulerRegistry, type OwnedScheduler } from "./dag-scheduler-registry"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

const changes = {
  completed: (record: DagRunRecordV1): DagRunRecordV1 => ({
    ...record,
    status: "completed",
    nodes: record.nodes.map((entry) => ({ ...entry, state: "completed" as const })),
  }),
  paused: (record: DagRunRecordV1): DagRunRecordV1 => ({ ...record, status: "paused" }),
} as const

describe("DAG scheduler registry acquisition of a pending run", () => {
  for (const [became, change] of Object.entries(changes)) {
    test(`#given a pending run that another host leaves ${became} just before this host acquires it #when it is scheduled #then nothing is journaled and nothing launches`, async () => {
      // given
      const directory = fs.mkdtempSync(join(tmpdir(), `omo-senpi-dag-registry-acquire-${became}-`))
      cleanupRoots.push(directory)
      const sessionId = "session-parent"
      const base = createDagFileStore({ project_dir: directory })
      const started = await createDagManager({ store: base }).start({
        parentSessionId: sessionId,
        rootSessionId: sessionId,
        definition: { key: "registry-acquire", name: "registry acquire", nodes: [dagNode("only")] },
      })
      const runId = started.snapshot.runId
      // The other host's write lands the moment this host next takes the run lock: after the
      // registry read the run as pending, before it acquires it.
      let raced = false
      const store: DagFileStore = {
        ...base,
        withRunLock: (lockedRunId, operation) => {
          if (!raced && lockedRunId === runId) {
            raced = true
            const record = base.readCheckpoint<DagRunRecordV1>(runId)
            if (record !== null) base.writeCheckpoint(runId, change(record))
          }
          return base.withRunLock(lockedRunId, operation)
        },
      }
      const taskManager = new LongRunningTaskManager()
      const schedulers = new Map<DagRunId, OwnedScheduler>()
      const isProcessAlive = (pid: number): boolean => pid === process.pid
      const registry = createDagSchedulerRegistry({
        schedulers,
        store,
        schedulerOptions: { reservations: createDagRunReservations(), store, taskManager, isProcessAlive },
        logger: quietLogger,
        isProcessAlive,
        reservations: createDagRunReservations(),
        recover: async () => undefined,
      })
      const eventsBefore = base.readEvents(runId, 0, { limit: 500 }).events.length

      // when
      registry.ensureScheduled(runId, sessionId)

      // then
      expect(raced).toBe(true)
      expect(schedulers.size).toBe(0)
      expect(base.readEvents(runId, 0, { limit: 500 }).events.length).toBe(eventsBefore)
      expect(taskManager.startOwnedCalls).toEqual([])
      expect(base.readCheckpoint<{ readonly leaseHolderPid?: number }>(runId)?.leaseHolderPid).toBeUndefined()
    })
  }
})
