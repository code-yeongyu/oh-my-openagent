// #15150 stack review 3: after its first decision a waiter never decides again without an event (the
// lifecycle's pass signal, the cancellation signal or its own child's settlement), and the frontier never
// re-arms a waiter that can settle again without one. A spin of folds and fences on microtasks alone
// starves the process; the spin guard turns it into a failure (too many task reads between two events).
import { afterEach, describe, expect, test } from "bun:test"

import { settled } from "../lifecycle/__fixtures__/deferred-revival-harness"
import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { makeNotCurrent, nodeFlag, spinGuard, withUnconfirmedStop } from "./__fixtures__/pending-revival-gate"
import {
  cleanupPendingRevivalRuns,
  freeSlot,
  lifecycleRetryTick,
  nodeStates,
  recoverRun,
  reopenOverCapacity,
  seedStaleChildOfRemovedNode,
} from "./__fixtures__/pending-revival-run"
import { runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"

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
// A handful of reads per event is a decision; anything near the guard's limit is a spin.
const READS_PER_EVENT = 50

/** A macrotask turn: every microtask queued so far has run (a spin never lets this resolve). */
async function oneTurn(): Promise<void> {
  await settled()
}

describe("a re-armed waiter waits for an event before it decides again (#15150, stack review 3)", () => {
  test("#given a not_current child whose stop is unconfirmed #when the stop lands later through an asynchronous event #then no decision repeats between events and the node then fails stale_attempt_alive", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const guard = spinGuard(withUnconfirmedStop(f.manager, hang))
    const run = await recoverRun(f, store, { taskManager: guard.taskManager })
    makeNotCurrent(f, hang)
    const flagged = nodeFlag(store, "k-hang")

    // when - the child is revived; the frontier asks it to stop and the stop stays unconfirmed
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    expect(await bounded(Promise.race([flagged, run.settled.then(() => "settled")]))).toContain(hang)
    guard.mark()
    await oneTurn()

    // then - flagged and active, and nothing decided again without an event
    expect(guard.reads()).toBeLessThan(READS_PER_EVENT)
    expect(nodeStates(store)).toEqual(WAITING)

    // when - the stop lands from a later macrotask
    await new Promise<void>((resolve) =>
      setImmediate(() => {
        f.store.mutate(hang, (record) => ({ ...record, status: "cancelled" }))
        resolve()
      }),
    )

    // then
    expect((await bounded(run.settled)).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:stale_attempt_alive", "k-after:skipped"])
  })

  test("#given a stale survivor whose stop is unconfirmed #when the node follows its own child #then no decision repeats between events", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const stale = seedStaleChildOfRemovedNode(f)
    const guard = spinGuard(withUnconfirmedStop(f.manager, stale))
    const run = await recoverRun(f, store, { taskManager: guard.taskManager })
    const flagged = nodeFlag(store, "k-hang")

    // when
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    expect(await bounded(Promise.race([flagged, run.settled.then(() => "settled")]))).toContain(stale)
    guard.mark()
    await oneTurn()

    // then
    expect(guard.reads()).toBeLessThan(READS_PER_EVENT)
    expect(f.store.load(hang)?.status).toBe("running")
    await run.scheduler.suspend()
  })

  test("#given a waiting node whose revival stays pending #when several lifecycle passes run #then each pass costs a bounded number of decisions", async () => {
    // given
    const f = overCapacity()
    const { store } = await reopenOverCapacity(f)
    const guard = spinGuard(f.manager)
    const run = await recoverRun(f, store, { taskManager: guard.taskManager })

    // when - three retry ticks pass with no free slot
    for (let tick = 0; tick < 3; tick += 1) {
      guard.mark()
      await lifecycleRetryTick(f)
      await oneTurn()
      // then
      expect(guard.reads()).toBeLessThan(READS_PER_EVENT)
    }
    expect(nodeStates(store)).toEqual(WAITING)
    await run.scheduler.suspend()
  })

  test("#given a not_current waiter re-armed after an unconfirmed stop #when the run is cancelled #then the drain stops the child and the run reads cancelled", async () => {
    // given - only the frontier's first stop is left unconfirmed; the cancel's drain is answered for real
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)
    const guard = spinGuard(withUnconfirmedStop(f.manager, hang, 1))
    const run = await recoverRun(f, store, { taskManager: guard.taskManager })
    makeNotCurrent(f, hang)
    const flagged = nodeFlag(store, "k-hang")
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    expect(await bounded(Promise.race([flagged, run.settled.then(() => "settled")]))).toContain(hang)
    guard.mark()
    await oneTurn()
    expect(guard.reads()).toBeLessThan(READS_PER_EVENT)

    // when
    await bounded(run.scheduler.cancel(runId, "user cancel"))

    // then
    await bounded(run.settled)
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("cancelled")
    expect(f.store.load(hang)?.status).toBe("cancelled")
  })
})
