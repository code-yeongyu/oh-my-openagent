// A re-entry takes the run's lease by the same holder rule the claim uses (#15125). A record written
// before schedulers recorded a lease names no holder; the live foreign process that still owns one of
// its active children is that holder, and a re-entry here would build a scheduler beside it.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, owner, pausedRecord, runId, taskRecord } from "./__fixtures__/reattached-run"
import type { DagDefinition } from "./graph"
import { reenterDagRun } from "./node-retry"
import { createDagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST_PID = 101
const LIVE_FOREIGN_PID = 9002
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG re-entry under the one holder rule", () => {
  test("#given a legacy record whose active child a live foreign process owns #when the amend re-entry runs #then it is refused naming that process and nothing is written", () => {
    // given - a settled (re-enterable) record with no lease and no previous holder, whose node still
    // names a child the live foreign process runs: only the holder rule can refuse it
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-reentry-holder-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore(ownedTaskState(directory))
    const manager = new LongRunningTaskManager()
    const definition: DagDefinition = { key: "reentry-holder", name: "reentry holder", nodes: [node("slow")] }
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
      slow: { state: "running", taskId: "task-slow", attempt: 1 },
    })
    const settled = { ...paused, status: "failed" as const }
    store.writeCheckpoint(runId, settled)
    manager.add({ ...taskRecord(owner("slow"), "running", "task-slow"), host_pid: LIVE_FOREIGN_PID })
    const bytes = (): string => fs.readFileSync(store.paths.run(runId), "utf8")
    const before = bytes()

    // when
    let refusal: unknown
    try {
      reenterDagRun({
        store,
        taskManager: manager,
        initialRecord: settled,
        hostPid: THIS_HOST_PID,
        isProcessAlive: (pid) => pid === LIVE_FOREIGN_PID,
      })
    } catch (error) {
      refusal = error
    }

    // then
    expect(refusal).toEqual(
      expect.objectContaining({ code: "run_not_owned", message: expect.stringContaining(String(LIVE_FOREIGN_PID)) }),
    )
    expect(bytes()).toBe(before)
    expect(fs.existsSync(store.paths.event(runId))).toBe(false)
    expect(manager.startOwnedCalls).toEqual([])
  })
})
