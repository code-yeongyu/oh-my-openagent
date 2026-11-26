// #15150, the owner's guard: a workflow node that waits for its child's pending revival can never stay
// `running` for good. Every pending state ends - the revival is refused (the node folds that reason), a
// restart while pending reaches the revival, and a lifecycle that is disposed or stops for shutdown ends
// the wait without journaling a failure. The deadline's ends live in recovery-pending-revival-deadline.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import { runId } from "./__fixtures__/reattached-run"
import { subscribeDagJournal } from "./journal"
import type { DagFileStore } from "./store"
import type { DagRunEvent } from "./types"
import {
  cleanupPendingRevivalRuns,
  finishRun,
  freeSlot,
  lifecycleRetryTick,
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

  test("#given the lifecycle cannot confirm its stop at the deadline #when its close attempt is over #then the node fails as orphaned instead of waiting on the close retries", async () => {
    // given - a child-process child whose pid survives every signal
    const f = liveParentFixture("child-process", { residency_max_children: 1, default_concurrency: 2 })
    fixtures.push(f)
    const { hang, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])
    f.state.stopConfirmed = false
    f.alivePids.add(f.store.load(hang)?.pid ?? 0)

    // when - the deadline's final attempt defers, and the expiry's close leaves the child unconfirmed
    f.advance(300_000)

    // then - the lifecycle's revival obligation ended with its close attempt; only its close retries remain
    expect((await bounded(run.settled)).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:resume_task_orphaned", "k-after:skipped"])
    expect(f.store.load(hang)).toMatchObject({ status: "running", killed: true, failure_kind: "suspended_unresumable" })
  })

  for (const [teardown, stop] of [
    ["the lifecycle is disposed", (f: ReturnType<typeof overCapacity>) => f.lifecycle.dispose?.()],
    [
      "the session's retries stop for shutdown",
      (f: ReturnType<typeof overCapacity>) =>
        f.lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT, reason: "quit" }),
    ],
  ] as const) {
    test(`#given a waiting node #when ${teardown} #then the waiter ends, the run parks and the node is not journaled failed`, async () => {
      // given
      const f = overCapacity()
      const { store } = await reopenOverCapacity(f)
      const run = await recoverRun(f, store)
      expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])

      // when
      await stop(f)

      // then - the scheduler holds no child it can follow, so it parks the run for the next recovery
      expect((await bounded(run.settled)).record?.status).toBe("paused")
      expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])
      expect(nodeTransitions(store, "k-hang")).toEqual([])
    })
  }
})
