// A first-generation run left `running` records no lease, so the claim reads its holder from the
// task that owns each active node. That owner is the node's CURRENT task, the one reconcile would
// reattach, and a task that already ended holds nothing even though its record keeps the host pid.
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
import { createDagRecovery } from "./recovery"
import { createDagFileStore } from "./store"
import type { TaskRecord } from "../state"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST_PID = 101
const DEAD_HOST_PID = 9001
const LIVE_FOREIGN_PID = 9002
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const definition: DagDefinition = {
  key: "interrupted-owner",
  name: "interrupted owner",
  nodes: [node("slow"), node("next", ["slow"])],
}

/** A first-generation run left `running` whose `slow` node still names `task-old`, plus the given tasks. */
function interruptedRun(tasks: readonly TaskRecord[]) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-interrupted-owner-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const manager = new LongRunningTaskManager()
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
    slow: { state: "running", taskId: "task-old", attempt: 1 },
    next: { state: "pending" },
  })
  store.writeCheckpoint(runId, { ...paused, status: "running" })
  for (const task of tasks) manager.add(task)
  const recovery = createDagRecovery({
    store,
    taskManager: manager,
    hostPid: THIS_HOST_PID,
    isProcessAlive: (pid) => pid === LIVE_FOREIGN_PID,
    isRunHeldInProcess: () => false,
  })
  return { install: () => recovery.installPausedRuns(parentSessionId, () => undefined) }
}

describe("DAG recovery of a first-generation run by its nodes' current owners", () => {
  test("#given an active node still attached to a prior attempt that ended under a live foreign pid #when the session reopens #then that ended task does not hold the run and it is claimed", async () => {
    // given
    const fixture = interruptedRun([
      { ...taskRecord(owner("slow"), "cancelled", "task-old"), host_pid: LIVE_FOREIGN_PID },
    ])

    // when
    const outcomes = await fixture.install()

    // then
    expect(outcomes).toEqual([{ runId, kind: "resumed" }])
  })

  test("#given an active node whose newer owned task runs under a live foreign pid #when the session reopens #then the run is left to that process", async () => {
    // given - the checkpoint still names the prior attempt; the newest owned task is the live one
    const fixture = interruptedRun([
      { ...taskRecord(owner("slow"), "error", "task-old"), host_pid: DEAD_HOST_PID },
      { ...taskRecord(owner("slow"), "running", "task-new"), host_pid: LIVE_FOREIGN_PID },
    ])

    // when
    const outcomes = await fixture.install()

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: LIVE_FOREIGN_PID }])
  })
})
