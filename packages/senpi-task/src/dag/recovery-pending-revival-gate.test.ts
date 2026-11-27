// #15150 stack review 1: when a waiting node's child is revived, the child gate may refuse to follow it.
// A stale live child of the run (a superseded attempt or a removed node) is rule 1's: it is stopped by
// the scheduler's own fence and the node follows its own child; a stale child whose stop is not confirmed
// keeps the node waiting. Only a child in hand that is itself not the node's current attempt is stopped,
// and the node's outcome is decided from whether that stop is confirmed.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import {
  cleanupPendingRevivalRuns,
  finishRun,
  freeSlot,
  lifecycleRetryTick,
  nodeStates,
  recoverRun,
  reopenOverCapacity,
  hangSideAfter,
  PARENT,
  seedRun,
  seedStaleChildOfRemovedNode,
  attachedTask,
} from "./__fixtures__/pending-revival-run"
import {
  journalEvent,
  makeNotCurrent,
  managerWith,
  nodeFlag,
  withUnconfirmedStop,
} from "./__fixtures__/pending-revival-gate"
import { runId } from "./__fixtures__/reattached-run"
import { settled } from "../lifecycle/__fixtures__/deferred-revival-harness"
import type { DagRunRecordV1 } from "./manager"
import { isLiveTask } from "./scheduler-context"
import type { DagNodeId } from "./types"

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

const WAITING = ["k-hang:running", "k-after:pending"]

describe("the child gate on a waiting node's revived child (#15150, stack review 1)", () => {
  test("#given a live child of a node the run no longer has #when the waiting node's child is revived #then the stale child is stopped and the node follows its own child to completion", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    const stale = seedStaleChildOfRemovedNode(f)
    const staleStopped = f.until(() => f.store.load(stale)?.status === "cancelled")

    // when
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    await bounded(Promise.race([staleStopped, run.settled]))

    // then - the stale child is the one stopped; the node's own revived child runs on and is followed
    expect(f.store.load(stale)?.status).toBe("cancelled")
    expect(f.store.load(hang)?.status).toBe("running")
    expect(nodeStates(store)).toEqual(WAITING)
    await finishRun(f, store, hang)
    expect((await bounded(run.settled)).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given a stale child whose stop is not confirmed #when the waiting node's child is revived #then the node follows its own child to completion with the survivor flagged, and the dependent's admission is refused until the survivor stops", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const stale = seedStaleChildOfRemovedNode(f)
    const run = await recoverRun(f, store, { taskManager: withUnconfirmedStop(f.manager, stale) })
    const flagged = nodeFlag(store, "k-hang")

    // when
    await freeSlot(f, side)
    await lifecycleRetryTick(f)

    // then - the survivor is named on the node, and the node follows its own child either way
    expect(await bounded(Promise.race([flagged, run.settled.then(() => "settled")]))).toContain(stale)
    expect(f.store.load(stale)?.status).toBe("running")
    f.resumedHandles.get(hang)?.settle({ status: "completed", finalResponse: "hang done" })
    expect((await bounded(run.settled)).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:failed:stale_attempt_alive"])

    // when - the survivor stops, and the refused dependent is retried
    f.store.mutate(stale, (record) => ({ ...record, status: "cancelled" }))
    const afterTask = attachedTask(store, "k-after")
    const reentry = run.scheduler.retryNode(runId, ["k-after" as DagNodeId])
    f.runner.handles.get(await bounded(afterTask))?.settle({ status: "completed", finalResponse: "after done" })

    // then
    expect((await bounded(reentry.run)).status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given a waiting node's stale-child fence while a sibling's owned start is in flight #when the run is cancelled #then the cancel waits for that start and stops the started child", async () => {
    // given - k-side's start is held open; k-hang waits for its task host
    const f = liveParentFixture("host-session", { default_concurrency: 3 })
    fixtures.push(f)
    const hang = await f.start()
    const store = seedRun(f, { "k-hang": hang }, hangSideAfter)
    f.host.daemon.alive = false
    await f.restart().reconcileOnSessionStart(PARENT)
    // An owned start in flight before its child exists (an admission-lease wait, a slow task host)
    const startEntered = Promise.withResolvers<undefined>()
    const startGate = Promise.withResolvers<undefined>()
    const taskManager = managerWith(f.manager, {
      startOwned: async (spec, owner) => {
        startEntered.resolve(undefined)
        await startGate.promise
        return f.manager.startOwned(spec, owner)
      },
    })
    const run = await recoverRun(f, store, { taskManager })
    await bounded(startEntered.promise)
    seedStaleChildOfRemovedNode(f)

    // when - the waiting node's child is revived (the gate refuses stale_live), then a cancel arrives
    f.host.daemon.alive = true
    f.state.revivable = true
    await lifecycleRetryTick(f)
    await settled()
    const cancelledEvent = journalEvent(store, "dag.run.cancelled")
    const cancelling = run.scheduler.cancel(runId, "user cancel")
    await bounded(Promise.race([cancelledEvent, settled().then(settled).then(settled)]))
    startGate.resolve(undefined)
    await bounded(cancelling)
    await bounded(run.settled)

    // then - nothing of the run is left live, the sibling's started child included
    const owned = f.manager.findOwnedTasks({ kind: "dag", runId })
    const sideTask = owned.find((task) => task.owner?.nodeId === "k-side")
    expect(sideTask?.status).toBe("cancelled")
    expect(owned.filter((task) => isLiveTask(task)).map((task) => task.task_id)).toEqual([])
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("cancelled")
  })

  test("#given the waiting node's own child is not its current attempt #when it is revived and its stop is confirmed #then it is stopped and the node fails stale_attempt_alive", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    makeNotCurrent(f, hang)

    // when
    await freeSlot(f, side)
    await lifecycleRetryTick(f)

    // then
    expect((await bounded(run.settled)).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:stale_attempt_alive", "k-after:skipped"])
    expect(f.store.load(hang)?.status).toBe("cancelled")
  })

  test("#given the waiting node's own child is not its current attempt #when it is revived and its stop is not confirmed #then the node stays active as a survivor until that stop lands", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store, { taskManager: withUnconfirmedStop(f.manager, hang) })
    makeNotCurrent(f, hang)
    const flagged = nodeFlag(store, "k-hang")

    // when
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    const outcome = await bounded(Promise.race([flagged, run.settled.then(() => "settled")]))

    // then - the child may still run, so its node is not failed
    expect(outcome).toContain(hang)
    expect(nodeStates(store)).toEqual(WAITING)

    // when - the stop lands
    f.store.mutate(hang, (record) => ({ ...record, status: "cancelled" }))

    // then
    expect((await bounded(run.settled)).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:stale_attempt_alive", "k-after:skipped"])
  })
})
