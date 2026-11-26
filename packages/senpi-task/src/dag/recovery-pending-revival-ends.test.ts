// #15150, the owner's guard: a workflow node that waits for its child's pending revival can never stay
// `running` for good. Every pending state ends - the child is revived (the node follows it), the revival
// is refused (the node fails with that reason), or the lifecycle's persisted recovery deadline passes
// (the node fails as orphaned) - including across a restart while the revival is still pending.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import { runId } from "./__fixtures__/reattached-run"
import { subscribeDagJournal } from "./journal"
import type { DagFileStore } from "./store"
import type { DagRunEvent } from "./types"
import {
  cleanupPendingRevivalRuns,
  finishRun,
  freeSlot,
  lifecycleRetryTick,
  nodeError,
  nodeStates,
  PARENT,
  recoverRun,
  reopenOverCapacity,
} from "./__fixtures__/pending-revival-run"

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

const SUSPENSION_BUDGET_MS = 300_000

function nodeTransitions(store: DagFileStore, nodeId: string): readonly string[] {
  return store
    .readEvents(runId, 0, { limit: 200, types: ["dag.node.transitioned"] })
    .events.flatMap((event) =>
      event.type === "dag.node.transitioned" && event.nodeId === nodeId ? [`${event.from}->${event.to}`] : [],
    )
}

function automaticRetryOf(store: DagFileStore, nodeId: string) {
  const seen = Promise.withResolvers<Extract<DagRunEvent, { readonly type: "dag.node.retried" }>>()
  const stop = subscribeDagJournal(store, runId, (event) => {
    if (event.type !== "dag.node.retried" || event.nodeId !== nodeId || event.automatic === undefined) return
    stop()
    seen.resolve(event)
  })
  return seen.promise
}

describe("ends of a pending revival under a waiting workflow node (#15150)", () => {
  test("#given the pending revival is refused for good #when the lifecycle retries #then the node fails with that reason and the run's infrastructure retry takes over", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    f.state.revivable = false
    f.state.permanentFailure = true
    await freeSlot(f, side)
    const retried = automaticRetryOf(store, "k-hang")

    // when
    f.advance(5_000)

    // then - the node folds the lifecycle's own terminal reason, exactly as an attached child would
    const retry = await retried
    expect(f.store.load(hang)).toMatchObject({ status: "error", failure_kind: "suspended_unresumable" })
    expect(nodeTransitions(store, "k-hang")).toEqual(["running->failed"])
    expect(retry).toMatchObject({ priorTaskId: hang, automatic: { failureKind: "suspended_unresumable" } })
    expect(nodeStates(store)[1]).toBe("k-after:pending")
    await run.scheduler.suspend()
  })

  test("#given no slot frees #when the lifecycle's recovery deadline passes #then the node fails as orphaned and its dependent is skipped", async () => {
    // given
    const f = overCapacity()
    const { hang, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)

    // when
    f.advance(SUSPENSION_BUDGET_MS)

    // then
    expect((await run.settled).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:resume_task_orphaned", "k-after:skipped"])
    expect(nodeError(store, "k-hang")).toContain(hang)
  })

  test("#given the host restarts while the revival is pending #when the next session start revives the child #then the new run's recovery follows it to completion", async () => {
    // given - the first process waits on the pending revival, then dies with its scheduler
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    await (await recoverRun(f, store)).scheduler.suspend()
    const reconciled = await f.restart().reconcileOnSessionStart(PARENT)
    expect(reconciled.outcomes.find((outcome) => outcome.task_id === hang)?.reason).toBe("capacity")

    // when
    const run = await recoverRun(f, store)
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    await finishRun(f, store, hang)

    // then
    expect((await run.settled).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given the host restarts after the recovery deadline passed #when the next session starts #then the stale pending state ends and the node fails", async () => {
    // given - the deadline passes while no process runs, so no lifecycle tick saw it
    const f = overCapacity()
    const { hang, store } = await reopenOverCapacity(f)
    await (await recoverRun(f, store)).scheduler.suspend()
    f.advance(SUSPENSION_BUDGET_MS, false)
    await f.restart().reconcileOnSessionStart(PARENT)

    // when
    const run = await recoverRun(f, store)

    // then
    expect((await run.settled).record?.status).toBe("failed")
    expect(nodeStates(store)[1]).toBe("k-after:skipped")
    expect(nodeStates(store)[0]).toStartWith("k-hang:failed")
    expect(f.manager.getResidentHandle(hang)).toBeUndefined()
  })
})
