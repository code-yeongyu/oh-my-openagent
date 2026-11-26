// #15150 review 1: at its recovery deadline the lifecycle makes ONE more revival attempt before it gives
// up (a wall-clock jump across sleep or a restart must not discard recoverable work). A waiting node
// must wait for that attempt: it follows the child the attempt revives, and folds the lifecycle's own
// terminal record when it does not - never a second copy of the deadline on the workflow side.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import {
  attachedTask,
  cleanupPendingRevivalRuns,
  finishRun,
  freeSlot,
  lifecycleRetryTick,
  nodeStates,
  PARENT,
  recoverRun,
  reopenOverCapacity,
} from "./__fixtures__/pending-revival-run"
import { runId } from "./__fixtures__/reattached-run"
import type { DagFileStore } from "./store"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
function overCapacity() {
  const f = liveParentFixture("in-process", { residency_max_children: 1, default_concurrency: 2 })
  fixtures.push(f)
  return f
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupPendingRevivalRuns()
  cleanupProjects()
  cleanupManagers()
})

const BUDGET_MS = 300_000
const TICK_MS = 5_000
const WAITING = ["k-hang:running", "k-after:pending"]

function journal(store: DagFileStore) {
  return store.readEvents(runId, 0, { limit: 500 }).events
}

/** The single outcome of a revival the lifecycle gave up on: the node folds its terminal record once. */
async function expectGaveUpOutcome(
  f: ReturnType<typeof liveParentFixture>,
  store: DagFileStore,
  hang: string,
  settled: Promise<unknown>,
) {
  const freshChild = await Promise.race([
    attachedTask(store, "k-hang"),
    settled.then(() => nodeStates(store).join(" ")),
  ])
  expect(freshChild).not.toBe(hang)
  expect(freshChild).toMatch(/^st_[0-9a-f]{8}$/)
  expect(f.store.load(hang)).toMatchObject({ status: "error", failure_kind: "suspended_unresumable" })
  const hangEvents = journal(store).flatMap((event) => {
    if (event.type === "dag.node.transitioned" && event.nodeId === "k-hang") return [`${event.from}->${event.to}`]
    if (event.type === "dag.node.retried" && event.nodeId === "k-hang")
      return [`retried:${event.priorTaskId}:${event.automatic?.failureKind ?? "manual"}`]
    return []
  })
  expect(hangEvents).toEqual(["running->failed", `retried:${hang}:suspended_unresumable`, "pending->scheduled"])
  expect(journal(store).some((event) => event.type === "dag.node.transitioned" && event.to === "skipped")).toBe(false)
  return freshChild
}

describe("a waiting node at the lifecycle's recovery deadline (#15150 review 1)", () => {
  test("#given no slot until the deadline #when a slot frees exactly at the deadline tick #then the node follows the child the final attempt revives and the run completes", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    f.advance(BUDGET_MS - TICK_MS)
    expect(nodeStates(store)).toEqual(WAITING)

    // when - the slot frees in the last window; the deadline tick makes the lifecycle's final attempt
    await freeSlot(f, side)
    await lifecycleRetryTick(f)

    // then
    expect(f.manager.getResidentHandle(hang)).toBeDefined()
    expect(nodeStates(store)).toEqual(WAITING)
    await finishRun(f, store, hang)
    expect((await run.settled).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given a restart after the deadline with a free slot #when workflow recovery reads while the session-start attempt is in flight #then the node waits and follows the revived child", async () => {
    // given - the deadline passes while no process runs; the slot is free by then
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    await (await recoverRun(f, store)).scheduler.suspend()
    await freeSlot(f, side)
    f.advance(BUDGET_MS, false)
    const gate = f.holdRevival()
    const lifecycle = f.restart()
    await lifecycle.reconcileOnSessionStart(PARENT)
    await gate.started

    // when - workflow recovery reads the answer while the lifecycle's once-only attempt is in flight
    const run = await recoverRun(f, store)
    expect(nodeStates(store)).toEqual(WAITING)
    const revived = f.wait("live_parent_recovery_attempt")
    gate.resolve()
    await revived

    // then
    expect(f.manager.getResidentHandle(hang)).toBeDefined()
    await finishRun(f, store, hang)
    expect((await run.settled).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given no slot ever frees #when the deadline's final attempt fails #then the node waits until then and folds the lifecycle's terminal record exactly once", async () => {
    // given
    const f = overCapacity()
    const { hang, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    expect(nodeStates(store)).toEqual(WAITING)
    f.advance(BUDGET_MS - TICK_MS)
    expect(nodeStates(store)).toEqual(WAITING)

    // when
    f.advance(TICK_MS)

    // then - one outcome: the fold, then the run's infrastructure retry with a fresh child
    const fresh = await expectGaveUpOutcome(f, store, hang, run.settled)
    expect(nodeStates(store)[1]).toBe("k-after:pending")
    f.runner.handles.get(fresh)?.settle({ status: "completed", finalResponse: "retried hang" })
    const after = await attachedTask(store, "k-after")
    f.runner.handles.get(after)?.settle({ status: "completed", finalResponse: "after done" })
    expect((await run.settled).record?.status).toBe("completed")
  })

  test("#given the host restarts after the deadline and no slot is free #when the next session starts #then the node folds the lifecycle's terminal record exactly once", async () => {
    // given
    const f = overCapacity()
    const { hang, store } = await reopenOverCapacity(f)
    await (await recoverRun(f, store)).scheduler.suspend()
    f.advance(BUDGET_MS, false)
    await f.restart().reconcileOnSessionStart(PARENT)

    // when
    const run = await recoverRun(f, store)

    // then
    const fresh = await expectGaveUpOutcome(f, store, hang, run.settled)
    f.runner.handles.get(fresh)?.settle({ status: "completed", finalResponse: "retried hang" })
    const after = await attachedTask(store, "k-after")
    f.runner.handles.get(after)?.settle({ status: "completed", finalResponse: "after done" })
    expect((await run.settled).record?.status).toBe("completed")
  })
})
