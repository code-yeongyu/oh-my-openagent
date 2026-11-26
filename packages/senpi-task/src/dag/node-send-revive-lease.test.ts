// A send that revives a child of a settled run this host does not hold takes the run over: it must
// acquire the run (holder rule, lease) before it touches the child, hold it while the revived node
// runs, and give the lease up in the write that folds the child's outcome (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SendInput, SendOutcome } from "../steering"
import { LongRunningTaskManager, node, owner, pausedRecord, runId, taskRecord } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
import { retryDagNodes } from "./node-retry"
import { sendToDagNode } from "./node-send"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const THIS_HOST = 101
const OTHER_HOST = 202
const LIVE_THIRD_HOST = 303
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number }

// A failed run: `a` failed with a finished resident child, `b` failed with none. The task manager
// answers every send with `answer` and records it; a revive reopens the child as running.
function failedRun(answer: SendOutcome["kind"], wrap: (base: DagFileStore) => DagFileStore = (base) => base) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-send-revive-"))
  cleanupRoots.push(directory)
  const base = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "send-revive", name: "send revive", nodes: [node("a"), node("b")] },
    { a: { state: "failed", taskId: "task-a", attempt: 1 }, b: { state: "failed" } },
  )
  const failed: DagRunRecordV1 = { ...paused, status: "failed" }
  base.writeCheckpoint(runId, failed)
  const sends: SendInput[] = []
  const leaseAtSend: Array<number | undefined> = []
  const manager = new LongRunningTaskManager()
  manager.add(taskRecord(owner("a"), "completed", "task-a"))
  const taskManager = Object.assign(manager, {
    sendToTask: async (input: SendInput): Promise<SendOutcome> => {
      sends.push(input)
      leaseAtSend.push(base.readCheckpoint<Leased>(runId)?.leaseHolderPid)
      if (answer !== "revived")
        return { kind: "not_continuable", task_id: input.idOrName, reason: "refused", suggestion: "retry" }
      const record = manager.get(input.idOrName)
      if (record !== undefined) manager.add({ ...record, status: "running" })
      return { kind: "revived", task_id: input.idOrName, run_epoch: 2 }
    },
  })
  const alive = (pid: number): boolean => pid === THIS_HOST || pid === LIVE_THIRD_HOST
  const send = () =>
    sendToDagNode(
      { store: wrap(base), taskManager, hostPid: THIS_HOST, isProcessAlive: alive, initialRecord: failed },
      runId,
      "a" as DagNodeId,
      "again",
    )
  const otherRetry = () =>
    retryDagNodes(
      { store: base, taskManager, hostPid: OTHER_HOST, isProcessAlive: alive, initialRecord: failed },
      runId,
      ["b" as DagNodeId],
    )
  const refusalOf = (operation: () => unknown): unknown => {
    try {
      operation()
      return undefined
    } catch (error) {
      return error
    }
  }
  const read = () => base.readCheckpoint<Leased>(runId)
  const events = () => base.readEvents(runId, 0, { limit: 500 }).events
  return { base, manager, sends, leaseAtSend, send, otherRetry, refusalOf, read, events }
}

describe("DAG send that revives a child of a run this host does not hold", () => {
  test("#given another live process takes the run between send's read and its acquisition #when the send arrives #then it is refused and the child is never touched", async () => {
    // given - the third host's lease lands the moment this host first takes the run lock
    let raced = false
    const run = failedRun("revived", (base) => ({
      ...base,
      withRunLock: (lockedRunId, operation) => {
        if (!raced && lockedRunId === runId) {
          raced = true
          const record = base.readCheckpoint<Leased>(runId)
          if (record !== null) base.writeCheckpoint(runId, { ...record, leaseHolderPid: LIVE_THIRD_HOST })
        }
        return base.withRunLock(lockedRunId, operation)
      },
    }))

    // when
    const refusal = await run.send().then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect(raced).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(run.sends).toEqual([])
    expect(run.events()).toEqual([])
    expect(run.read()?.leaseHolderPid).toBe(LIVE_THIRD_HOST)
  })

  test("#given a revive in flight #when another host retries a node of the run #then this host's lease holds the run and the retry is refused", async () => {
    // given
    const run = failedRun("revived")

    // when
    const result = await run.send()

    // then
    expect(result.delivery).toBe("revive")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    expect(run.read()?.nodes.find((entry) => entry.id === "a")?.state).toBe("running")
    expect(run.refusalOf(run.otherRetry)).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    run.manager.complete("task-a")
    await result.settled
  })

  test("#given a revive in flight #when the revived child's outcome is folded #then the lease leaves in that same write and another host's retry is accepted", async () => {
    // given
    const run = failedRun("revived")
    const result = await run.send()
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)

    // when
    run.manager.complete("task-a")
    await result.settled

    // then - the checkpoint after the fold carries the fold's own seq and no lease
    const fold = run.events().at(-1)
    expect(fold).toEqual(expect.objectContaining({ type: "dag.node.transitioned", nodeId: "a", to: "completed" }))
    expect(run.read()).toEqual(expect.objectContaining({ checkpointSeq: fold?.seq }))
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    const reentry = run.otherRetry()
    expect((await reentry.run).status).toBe("completed")
  })

  test("#given a run this host acquires for a revive #when the task manager refuses the revive #then no lease and no running node are left", async () => {
    // given
    const run = failedRun("not_continuable")

    // when
    const refusal = await run.send().then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_continuable" }))
    expect(run.leaseAtSend).toEqual([THIS_HOST])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.read()?.nodes.find((entry) => entry.id === "a")?.state).toBe("failed")
    expect(run.events()).toEqual([])
  })

  test("#given a run its reviving host left with a node shown running #when this host's revive of another node is refused #then this host leaves no lease behind", async () => {
    // given - a dead host's lease, and its revived node `b` still shown running
    const run = failedRun("not_continuable")
    const left = run.read()
    if (left === null) throw new Error("expected a checkpoint")
    const nodes = left.nodes.map((entry) =>
      entry.id === "b" ? { ...entry, state: "running" as const, taskId: "task-b-dead" } : entry,
    )
    run.base.writeCheckpoint(runId, { ...left, nodes, leaseHolderPid: 9_999_999 })

    // when
    const refusal = await run.send().then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_continuable" }))
    expect(run.leaseAtSend).toEqual([THIS_HOST])
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })
})
