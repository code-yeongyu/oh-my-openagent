// A host that dies without writing its shutdown pause (kill, crash, power loss) leaves its run
// `running`. Recovery used to claim paused runs only, so the session that reopened never took the
// run over: its finished child was never folded and its dependents never started.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  awaitJournalEvents,
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
import { createDagRecovery, type DagRecoveryOptions } from "./recovery"
import { createDagFileStore, type DagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST_PID = 101
const DEAD_HOST_PID = 9001
const LIVE_FOREIGN_PID = 9002
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const definition: DagDefinition = {
  key: "interrupted-run",
  name: "interrupted run",
  nodes: [node("slow"), node("next", ["slow"])],
}

type Lease = { readonly leaseHolderPid?: number }

/** The checkpoint a killed host leaves: still `running`, its first node attached to a child. */
function interruptedRun(lease: Lease, childOwnerPid = THIS_HOST_PID) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-interrupted-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const manager = new LongRunningTaskManager()
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
    slow: { state: "running", taskId: "task-slow", attempt: 1 },
    next: { state: "pending" },
  })
  store.writeCheckpoint(runId, { ...paused, status: "running", ...lease })
  manager.add({ ...taskRecord(owner("slow"), "running", "task-slow"), host_pid: childOwnerPid })
  return { store, manager }
}

function recoveryFor(
  fixture: { readonly store: DagFileStore; readonly manager: LongRunningTaskManager },
  options: Pick<DagRecoveryOptions, "isProcessAlive" | "isRunHeldInProcess">,
) {
  return createDagRecovery({
    store: fixture.store,
    taskManager: fixture.manager,
    hostPid: THIS_HOST_PID,
    ...options,
  })
}

function checkpoint(store: DagFileStore): (DagRunRecordV1 & Lease) | null {
  return store.readCheckpoint<DagRunRecordV1 & Lease>(runId)
}

function resumedEvents(store: DagFileStore): number {
  return store.readEvents(runId, 0, { limit: 500 }).events.filter((event) => event.type === "dag.run.resumed").length
}

describe("DAG recovery of a run its host left running", () => {
  for (const [given, lease] of [
    ["a recovered run whose recorded holder is dead", { leaseHolderPid: DEAD_HOST_PID }],
    ["a first-generation run, which records no holder,", {}],
  ] as const) {
    test(`#given ${given} and its child still alive #when the session reopens #then the run is claimed, the child folds, and the dependent starts`, async () => {
      // given
      const fixture = interruptedRun(lease)
      const recovery = recoveryFor(fixture, { isProcessAlive: () => false, isRunHeldInProcess: () => false })
      const resumed = awaitJournalEvents(fixture.store, ["dag.run.resumed"], 5_000)

      // when - the claim must be journaled while the child is still running, not when recovery returns
      const resume = recovery.resumePausedRuns(parentSessionId)
      const first = await Promise.race([
        resumed.missing.then((missing) =>
          missing.length === 0 ? "resumed" : `deadline: missing ${missing.join(", ")}`,
        ),
        resume.then(() => "returned"),
      ])
      resumed.stop()

      // then
      expect(first).toBe("resumed")
      expect(checkpoint(fixture.store)?.leaseHolderPid).toBe(THIS_HOST_PID)

      // and then - the child that outlived the host folds, and its dependent is admitted
      fixture.manager.complete("task-slow")
      const [outcome] = await resume
      expect(outcome?.kind).toBe("resumed")
      expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
        "slow:completed",
        "next:completed",
      ])
      expect(fixture.manager.startOwnedCalls).toEqual(["next"])
    })
  }

  test("#given a run left running whose recorded holder is still alive #when the session reopens #then it is skipped as a live lease and left untouched", async () => {
    // given
    const fixture = interruptedRun({ leaseHolderPid: LIVE_FOREIGN_PID })
    const recovery = recoveryFor(fixture, {
      isProcessAlive: (pid) => pid === LIVE_FOREIGN_PID,
      isRunHeldInProcess: () => false,
    })

    // when
    const outcomes = await recovery.resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: LIVE_FOREIGN_PID }])
    expect(checkpoint(fixture.store)?.leaseHolderPid).toBe(LIVE_FOREIGN_PID)
    expect(resumedEvents(fixture.store)).toBe(0)
  })

  test("#given a first-generation run whose attached child a live foreign process still owns #when the session reopens #then it is skipped as a live lease naming that owner", async () => {
    // given
    const fixture = interruptedRun({}, LIVE_FOREIGN_PID)
    const recovery = recoveryFor(fixture, {
      isProcessAlive: (pid) => pid === LIVE_FOREIGN_PID,
      isRunHeldInProcess: () => false,
    })

    // when
    const outcomes = await recovery.resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: LIVE_FOREIGN_PID }])
    expect(resumedEvents(fixture.store)).toBe(0)
  })

  test("#given a run left running whose node still has to launch #when two recovery sweeps overlap #then one claims it and the other leaves it to this host", async () => {
    // given - the claimed run is still launching its child when the second sweep reads it
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-interrupted-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore(ownedTaskState(directory))
    const manager = new LongRunningTaskManager()
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
      slow: { state: "scheduled" },
      next: { state: "pending" },
    })
    store.writeCheckpoint(runId, { ...paused, status: "running", leaseHolderPid: DEAD_HOST_PID })
    const recovery = recoveryFor({ store, manager }, { isProcessAlive: () => false, isRunHeldInProcess: () => false })

    // when
    const [first, second] = await Promise.all([
      recovery.resumePausedRuns(parentSessionId),
      recovery.resumePausedRuns(parentSessionId),
    ])

    // then
    expect(first.map((outcome) => outcome.kind)).toEqual(["resumed"])
    expect(second).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: THIS_HOST_PID }])
    expect(resumedEvents(store)).toBe(1)
    expect(manager.startOwnedCalls).toEqual(["slow", "next"])
  })

  for (const [given, isRunHeldInProcess] of [
    ["this process still schedules", () => true],
    ["no in-process registry can vouch for", undefined],
  ] as const) {
    test(`#given a running run that ${given} #when recovery runs #then it is not claimed`, async () => {
      // given
      const fixture = interruptedRun({ leaseHolderPid: DEAD_HOST_PID })
      const recovery = recoveryFor(fixture, {
        isProcessAlive: () => false,
        ...(isRunHeldInProcess === undefined ? {} : { isRunHeldInProcess }),
      })

      // when
      const outcomes = await recovery.resumePausedRuns(parentSessionId)

      // then
      expect(outcomes).toEqual([])
      expect(checkpoint(fixture.store)?.leaseHolderPid).toBe(DEAD_HOST_PID)
      expect(resumedEvents(fixture.store)).toBe(0)
    })
  }
})
