// A shutdown retires a recovered run's scheduler first and writes the pause after. The lease must
// survive that interval: a `running` record with no holder is exactly what another process's
// recovery claims (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  LongRunningTaskManager,
  node,
  owner,
  parentSessionId,
  pausedRecord,
  runId,
  taskRecord,
} from "./__fixtures__/reattached-run"
import type { DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import { createDagRecovery, type InstalledDagRun } from "./recovery"
import { createDagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST_PID = 101
const OTHER_HOST_PID = 202
const DEAD_HOST_PID = 9001
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }

describe("DAG recovery lease across a shutdown retirement", () => {
  test("#given a recovered run whose scheduler is retired #when another process runs recovery before the shutdown pause #then this host's lease still holds the run, and the pause hands it over", async () => {
    // given - a run a dead host left running, its child now owned by no live process
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-retire-lease-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore(ownedTaskState(directory))
    const manager = new LongRunningTaskManager()
    const definition: DagDefinition = { key: "retire-lease", name: "retire lease", nodes: [node("slow")] }
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
      slow: { state: "running", taskId: "task-slow", attempt: 1 },
    })
    store.writeCheckpoint(runId, { ...paused, status: "running", leaseHolderPid: DEAD_HOST_PID })
    manager.add({ ...taskRecord(owner("slow"), "running", "task-slow"), host_pid: DEAD_HOST_PID })
    const installed: InstalledDagRun[] = []
    const thisHost = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: THIS_HOST_PID,
      isProcessAlive: () => false,
      isRunHeldInProcess: () => false,
    })
    await thisHost.installPausedRuns(parentSessionId, (run) => installed.push(run))
    const recovered = installed[0]
    if (recovered === undefined) throw new Error("expected the run to be installed")

    // when - the shutdown's retirement, without its pause yet
    await recovered.scheduler.suspend()
    await recovered.settled

    // then
    expect(store.readCheckpoint<Leased>(runId)?.leaseHolderPid).toBe(THIS_HOST_PID)
    const otherHost = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: OTHER_HOST_PID,
      isProcessAlive: (pid) => pid === THIS_HOST_PID,
      isRunHeldInProcess: () => false,
    })
    expect(await otherHost.installPausedRuns(parentSessionId, () => undefined)).toEqual([
      { runId, kind: "skipped", reason: "live_lease", holderPid: THIS_HOST_PID },
    ])

    // and then - the shutdown pause moves the lease to the previous holder in the same write
    thisHost.pauseRunsForShutdown(parentSessionId)
    const handedOver = store.readCheckpoint<Leased>(runId)
    expect(handedOver?.status).toBe("paused")
    expect(handedOver?.leaseHolderPid).toBeUndefined()
    expect(handedOver?.previousLeaseHolderPid).toBe(THIS_HOST_PID)
  })
})
