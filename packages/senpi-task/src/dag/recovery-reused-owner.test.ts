// A lease-less run's holder is the live foreign owner of a node's current child (#15125). That owner
// is judged as the lifecycle judges it (`recordOwnerAlive`): a pid the OS gave to another process,
// whose start contradicts the claim's stamp, owns nothing, so the run is not left to it (#12077).
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
import { createOwnerProcessView } from "../lifecycle/owner-process"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST_PID = 101
const OWNER_PID = 9002
const DEAD_PID = 9003
const CLAIMED_START = "linux-proc-start-ticks:100"
const REUSED_START = "linux-proc-start-ticks:999"
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const definition: DagDefinition = {
  key: "reused-owner",
  name: "reused owner",
  nodes: [node("slow"), node("next", ["slow"])],
}

/**
 * A run left `running` with no lease and no previous holder, whose `slow` node's child runs under
 * `ownerPid`; `stamp` is the claim's start, and the OS reports `observedStart` for that pid now.
 */
function leaseLessRun(input: { readonly ownerPid: number; readonly stamp?: string; readonly observedStart: string }) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-reused-owner-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const manager = new LongRunningTaskManager()
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
    slow: { state: "running", taskId: "task-slow", attempt: 1 },
    next: { state: "pending" },
  })
  store.writeCheckpoint(runId, { ...paused, status: "running" })
  manager.add({
    ...taskRecord(owner("slow"), "running", "task-slow"),
    host_pid: input.ownerPid,
    ...(input.stamp === undefined
      ? {}
      : { host_claim: { pid: input.ownerPid, at: "2026-08-25T00:00:00.000Z", start: input.stamp } }),
  })
  const starts = new Map([[input.ownerPid, input.observedStart]])
  const recovery = createDagRecovery({
    store,
    taskManager: manager,
    hostPid: THIS_HOST_PID,
    isProcessAlive: (pid) => pid === OWNER_PID,
    ownerProcesses: createOwnerProcessView(async (pid) => starts.get(pid) ?? null),
    isRunHeldInProcess: () => false,
  })
  const bytes = (): string => fs.readFileSync(store.paths.run(runId), "utf8")
  const eventTypes = () => store.readEvents(runId, 0, { limit: 500 }).events.map((event) => event.type)
  return { store, bytes, eventTypes, install: () => recovery.installPausedRuns(parentSessionId, () => undefined) }
}

describe("DAG recovery of a lease-less run whose child names a reused owner pid", () => {
  test("#given the child's owner pid is alive but its start contradicts the claim's stamp #when the session reopens #then the run is claimed and its child handled exactly as a dead owner's", async () => {
    // given
    const reused = leaseLessRun({ ownerPid: OWNER_PID, stamp: CLAIMED_START, observedStart: REUSED_START })
    const dead = leaseLessRun({ ownerPid: DEAD_PID, stamp: CLAIMED_START, observedStart: CLAIMED_START })

    // when
    const outcomes = await reused.install()
    const deadOutcomes = await dead.install()

    // then
    expect(outcomes).toEqual([{ runId, kind: "resumed" }])
    expect(reused.eventTypes()).toContain("dag.run.resumed")
    expect(deadOutcomes).toEqual([{ runId, kind: "resumed" }])
    expect(reused.eventTypes()).toEqual(dead.eventTypes())
  })

  test("#given the child's owner pid is alive and its start matches the claim's stamp #when the session reopens #then the run is left to that owner and nothing is written", async () => {
    // given
    const fixture = leaseLessRun({ ownerPid: OWNER_PID, stamp: CLAIMED_START, observedStart: CLAIMED_START })
    const before = fixture.bytes()

    // when
    const outcomes = await fixture.install()

    // then
    expect(outcomes).toEqual([
      expect.objectContaining({ runId, kind: "skipped", reason: "live_lease", holderPid: OWNER_PID }),
    ])
    expect(fixture.bytes()).toBe(before)
    expect(fixture.eventTypes()).toEqual([])
  })

  test("#given an old child record with no start stamp under a live pid #when the session reopens #then the pid alone still holds the run", async () => {
    // given - the OS would report another start for the pid, but the record has no stamp to contradict
    const fixture = leaseLessRun({ ownerPid: OWNER_PID, observedStart: REUSED_START })
    const before = fixture.bytes()

    // when
    const outcomes = await fixture.install()

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: OWNER_PID }])
    expect(fixture.bytes()).toBe(before)
  })
})
