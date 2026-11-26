// An amendment is a write to its run like any other: decided at the write, under the run lock, by the
// ONE holder rule with the caller's probe (lease, then previous holder, then the live owner of an
// active child). A user Stop of a parked run leaves no lease while another process may still own its
// child; a lease-only check let an amendment through there (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, owner, pausedRecord, runId, taskRecord } from "./__fixtures__/reattached-run"
import { createDagManager, type DagRunRecordV1 } from "./manager"
import { retryDagNodes } from "./node-retry"
import { liveForeignHolder } from "./run-lease"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST = 101
const OTHER_HOST = 303
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Shape = {
  readonly childOwner: number
  readonly lease?: number
  readonly leaseAtWrite?: number
  readonly childOwnerAtWrite?: number
}

// A user-stopped run with no lease: `busy` is scheduled with a started child owned by `childOwner`,
// `open` is pending, `broken` failed. Only `alive` pids are alive to the injected probe.
function stoppedRun(shape: Shape, alive: ReadonlySet<number>) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-amend-holder-"))
  cleanupRoots.push(directory)
  const base = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "amend-holder", name: "amend holder", nodes: [node("busy"), node("open"), node("broken")] },
    { busy: { state: "scheduled", taskId: "task-busy" }, open: { state: "pending" }, broken: { state: "failed" } },
  )
  const stopped = {
    ...paused,
    pause: { reason: "user_stop", pauseSeq: 2 },
    ...(shape.lease === undefined ? {} : { leaseHolderPid: shape.lease }),
  } as DagRunRecordV1
  base.writeCheckpoint(runId, stopped)
  const taskManager = new LongRunningTaskManager()
  taskManager.add({ ...taskRecord(owner("busy"), "running", "task-busy"), host_pid: shape.childOwner })
  let flipped = false
  const store: DagFileStore = {
    ...base,
    withRunLock: (lockedRunId, operation) => {
      if (!flipped && lockedRunId === runId) {
        flipped = true
        if (shape.leaseAtWrite !== undefined)
          base.writeCheckpoint(runId, { ...stopped, leaseHolderPid: shape.leaseAtWrite } as DagRunRecordV1)
        if (shape.childOwnerAtWrite !== undefined)
          taskManager.add({ ...taskRecord(owner("busy"), "running", "task-busy"), host_pid: shape.childOwnerAtWrite })
      }
      return base.withRunLock(lockedRunId, operation)
    },
  }
  const probe = { taskManager, hostPid: THIS_HOST, isProcessAlive: (pid: number) => alive.has(pid) }
  const holder = (fresh: DagRunRecordV1) => liveForeignHolder(probe, fresh)
  const amend = () =>
    createDagManager({ store }).amend({
      runId,
      parentSessionId: stopped.parentSessionId,
      holder,
      definition: {
        key: "amend-holder",
        name: "amend holder",
        nodes: [node("busy"), { ...node("open"), prompt: "changed" }, node("broken")],
      },
    })
  const fingerprint = () => base.readCheckpoint<DagRunRecordV1>(runId)?.definitionFingerprint
  const events = () => base.readEvents(runId, 0, { limit: 500 }).events
  return { stopped, store, taskManager, probe, amend, fingerprint, events }
}

const outcomeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  )

describe("DAG amendment under the one holder rule", () => {
  test("#given a user-stopped run with no lease whose child another live process owns #when it is amended #then run_not_owned and nothing is written", async () => {
    const run = stoppedRun({ childOwner: OTHER_HOST }, new Set([THIS_HOST, OTHER_HOST]))
    expect(await outcomeOf(run.amend())).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(run.fingerprint()).toBe(run.stopped.definitionFingerprint)
    expect(run.events()).toEqual([])
  })

  test("#given the same run whose child owner is dead #when it is amended #then the amendment applies", async () => {
    const run = stoppedRun({ childOwner: OTHER_HOST }, new Set([THIS_HOST]))
    expect(await outcomeOf(run.amend())).toBeUndefined()
    expect(run.fingerprint()).not.toBe(run.stopped.definitionFingerprint)
  })

  test("#given a live foreign lease landing inside the amendment's own write lock #when it is amended #then run_not_owned and nothing is written", async () => {
    const run = stoppedRun({ childOwner: THIS_HOST, leaseAtWrite: OTHER_HOST }, new Set([THIS_HOST, OTHER_HOST]))
    expect(await outcomeOf(run.amend())).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(run.fingerprint()).toBe(run.stopped.definitionFingerprint)
    expect(run.events()).toEqual([])
  })

  for (const [whose, shape] of [
    ["this host's lease", { childOwner: THIS_HOST, lease: THIS_HOST }],
    ["this host's own child", { childOwner: THIS_HOST }],
  ] as const) {
    test(`#given ${whose} on the stopped run #when it is amended #then it is not refused`, async () => {
      const run = stoppedRun(shape, new Set([THIS_HOST, OTHER_HOST]))
      expect(await outcomeOf(run.amend())).toBeUndefined()
      expect(run.fingerprint()).not.toBe(run.stopped.definitionFingerprint)
    })
  }

  test("#given another live process takes over the stopped run's child inside the prompt override's write lock #when a retry stages the override #then run_not_owned and the definition is unchanged", () => {
    const run = stoppedRun({ childOwner: THIS_HOST, childOwnerAtWrite: OTHER_HOST }, new Set([THIS_HOST, OTHER_HOST]))
    let refusal: unknown
    try {
      retryDagNodes(
        {
          store: run.store,
          taskManager: run.taskManager,
          hostPid: THIS_HOST,
          isProcessAlive: run.probe.isProcessAlive,
          initialRecord: run.stopped,
        },
        runId,
        ["broken" as DagNodeId],
        { prompt: "fixed" },
      )
    } catch (error) {
      refusal = error
    }
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(run.fingerprint()).toBe(run.stopped.definitionFingerprint)
  })
})
