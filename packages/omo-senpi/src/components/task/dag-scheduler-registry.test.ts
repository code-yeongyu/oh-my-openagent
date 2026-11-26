// pauseForShutdown retires every scheduler this runtime runs and only then writes the shutdown pause.
// Between the two the run is still this host's: its record must keep this host's lease, or another
// process's recovery reads a `running` run with no holder and claims it (#15125).
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
} from "@oh-my-opencode/senpi-task/dag"

import { LongRunningTaskManager, taskRecord } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { subscribeDagJournal } from "../../../../senpi-task/src/dag/journal"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import type { DagNodeId } from "../../../../senpi-task/src/dag/types"
import { dagNode, FOREIGN_HOST_PID, within } from "./dag-runtime-recovery.test-support"
import { createDagSchedulerRegistry, type OwnedScheduler } from "./dag-scheduler-registry"

const DEAD_CHILD_HOST_PID = 2_147_483_646
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }

describe("DAG scheduler registry lease across a shutdown retirement", () => {
  test("#given a run this runtime schedules #when its scheduler is retired before the shutdown pause #then the record keeps this host's lease and another process's recovery leaves it alone", async () => {
    // given - a run whose only child stays running, recorded under a host no longer alive
    const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-registry-lease-"))
    cleanupRoots.push(directory)
    const sessionId = "session-parent"
    const store = createDagFileStore({ project_dir: directory })
    const coreManager = createDagManager({ store })
    const taskManager = new LongRunningTaskManager()
    const started = await coreManager.start({
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      definition: { key: "registry-lease", name: "registry lease", nodes: [dagNode("only")] },
    })
    const runId = started.snapshot.runId
    const owner = { kind: "dag" as const, runId, nodeId: "only" as DagNodeId, fingerprint: "unused-by-fake" }
    taskManager.add({ ...taskRecord(owner, "running", "task-only"), host_pid: DEAD_CHILD_HOST_PID })
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
    let unsubscribe = (): void => undefined
    const attached = new Promise<void>((resolve) => {
      unsubscribe = subscribeDagJournal(store, runId, (event) => {
        if (event.type === "dag.node.task-attached") resolve()
      })
    })
    registry.ensureScheduled(runId, sessionId)
    await within(attached, "the child attaching")
    unsubscribe()

    // when - the shutdown's retirement, exactly as pauseForShutdown does it, without its pause yet
    const owned = schedulers.get(runId)
    if (owned === undefined) throw new Error("expected a registered scheduler")
    await owned.scheduler.suspend()
    await Promise.allSettled([owned.running])

    // then
    expect(store.readCheckpoint<Leased>(runId)?.leaseHolderPid).toBe(process.pid)
    const otherHost = createDagRecovery({
      store,
      taskManager,
      hostPid: FOREIGN_HOST_PID,
      isProcessAlive,
      isRunHeldInProcess: () => false,
    })
    expect(await otherHost.installPausedRuns(sessionId, () => undefined)).toEqual([
      { runId, kind: "skipped", reason: "live_lease", holderPid: process.pid },
    ])
  })
})
