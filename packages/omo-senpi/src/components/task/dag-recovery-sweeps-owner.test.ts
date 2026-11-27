// A `live_lease` skip arms a lease watch that re-runs recovery when the holder is gone. For a run held
// by a node's child, the watch watches that child's owner as the holder rule judged it (#12077): no
// watch for an owner whose start contradicts the claim (the run was claimed), and a watched owner
// whose pid the OS gives to another process is gone, so recovery runs again and claims the run.
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
} from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRecovery } from "../../../../senpi-task/src/dag/recovery"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import { createOwnerProcessView } from "../../../../senpi-task/src/lifecycle/owner-process"
import { ownedTaskState } from "../../../../senpi-task/src/store/__fixtures__/owned-task-state"
import { createDagRecoverySweeps } from "./dag-recovery-sweeps"
import { ManualTimers, within } from "./dag-runtime-recovery.test-support"

const THIS_HOST = 101
const OWNER_PID = 9002
const CLAIMED_START = "linux-proc-start-ticks:100"
const REUSED_START = "linux-proc-start-ticks:999"
const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A lease-less run left `running` whose `slow` child the OS reports under `starts`, and its sweeps. */
function sweptRun(observedStart: string) {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-sweeps-owner-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "sweeps-owner", name: "sweeps owner", nodes: [node("slow"), node("next", ["slow"])] },
    { slow: { state: "running", taskId: "task-slow", attempt: 1 }, next: { state: "pending" } },
  )
  store.writeCheckpoint(runId, { ...paused, status: "running" })
  const manager = new LongRunningTaskManager()
  manager.add({
    ...taskRecord(owner("slow"), "running", "task-slow"),
    host_pid: OWNER_PID,
    host_claim: { pid: OWNER_PID, at: "2026-08-25T00:00:00.000Z", start: CLAIMED_START },
  })
  const starts = new Map([[OWNER_PID, observedStart]])
  const isProcessAlive = (pid: number): boolean => pid === OWNER_PID
  const ownerProcesses = createOwnerProcessView(async (pid) => starts.get(pid) ?? null)
  const recovery = createDagRecovery({
    store,
    taskManager: manager,
    hostPid: THIS_HOST,
    isProcessAlive,
    ownerProcesses,
    isRunHeldInProcess: () => false,
  })
  const timers = new ManualTimers()
  let markRecovered = (): void => undefined
  const recoveredAgain = new Promise<void>((resolve) => (markRecovered = resolve))
  const sweeps = createDagRecoverySweeps({
    leaseWatch: { isProcessAlive, ownerProcesses, timers, intervalMs: 250 },
    logger: quietLogger,
    install: (scope) => recovery.installPausedRuns(scope.sessionId, () => undefined),
    afterSweep: () => undefined,
    activeSessionId: () => parentSessionId,
    onRecovered: () => markRecovered(),
  })
  const eventTypes = () => store.readEvents(runId, 0, { limit: 500 }).events.map((event) => event.type)
  return { starts, timers, sweeps, recoveredAgain, eventTypes }
}

describe("DAG recovery sweeps and the lease watch on a node child's owner", () => {
  test("#given the child's owner pid is alive but its start contradicts the claim's stamp #when the sweep runs #then the run is claimed and no watch is armed", async () => {
    // given
    const run = sweptRun(REUSED_START)

    // when
    const outcomes = await run.sweeps.recover({ sessionId: parentSessionId })

    // then
    expect(outcomes).toEqual([{ runId, kind: "resumed" }])
    expect(run.timers.pending()).toBe(0)
    await run.sweeps.close()
  })

  test("#given the sweep left the run to a child owner whose start matches #when the OS gives that pid to another process #then the watch fires and the next sweep claims the run", async () => {
    // given
    const run = sweptRun(CLAIMED_START)
    const outcomes = await run.sweeps.recover({ sessionId: parentSessionId })
    expect(outcomes).toEqual([
      expect.objectContaining({ runId, kind: "skipped", reason: "live_lease", holderPid: OWNER_PID }),
    ])
    expect(run.timers.pending()).toBe(1)

    // when
    run.starts.set(OWNER_PID, REUSED_START)
    run.timers.tick()
    await within(run.recoveredAgain, "the recovery the lease watch re-runs")

    // then
    expect(run.eventTypes()).toContain("dag.run.resumed")
    expect(run.timers.pending()).toBe(0)
    await run.sweeps.close()
  })
})
