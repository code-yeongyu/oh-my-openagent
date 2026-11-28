// #15150: when a session reopens, the lifecycle may not revive a workflow child at once: no residency
// slot is free (deferred for capacity) or its task host does not answer yet (parked daemon_unavailable).
// The lifecycle owes that child a revival or an end by its persisted recovery deadline. Workflow
// recovery runs after lifecycle reconcile and must not fail such a node as orphaned: the node waits,
// follows the child once it is revived, and only fails when that pending state ends without it.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
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
  reopenWithTaskHostDown,
  seedRun,
} from "./__fixtures__/pending-revival-run"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
function fixture(...args: Parameters<typeof liveParentFixture>) {
  const f = liveParentFixture(...args)
  fixtures.push(f)
  return f
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupPendingRevivalRuns()
  cleanupProjects()
  cleanupManagers()
})

const overCapacity = () => fixture("in-process", { residency_max_children: 1, default_concurrency: 2 })

describe("workflow recovery of a node whose child's revival is pending (#15150)", () => {
  test("#given a child deferred for capacity at session start #when workflow recovery runs #then the node waits, follows the revived child, and the run completes", async () => {
    // given
    const f = overCapacity()
    const { hang, side, store } = await reopenOverCapacity(f)

    // when - workflow recovery runs strictly after lifecycle reconcile
    const run = await recoverRun(f, store)

    // then - the node is neither failed nor followed by its dependent while the revival is pending
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])

    // when - a slot frees and the lifecycle's own retry revives the child
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    expect(f.manager.getResidentHandle(hang)).toBeDefined()
    await finishRun(f, store, hang)

    // then
    expect((await run.settled).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given the task host is unreachable at session start #when workflow recovery runs #then the node waits and follows the child once the host answers", async () => {
    // given
    const f = fixture("host-session")
    const { hang, store } = await reopenWithTaskHostDown(f)

    // when
    const run = await recoverRun(f, store)

    // then
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])

    // when - the task host answers again and live-parent recovery revives the child
    f.host.daemon.alive = true
    f.state.revivable = true
    await lifecycleRetryTick(f)
    expect(f.manager.getResidentHandle(hang)).toBeDefined()
    await finishRun(f, store, hang)

    // then
    expect((await run.settled).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })

  test("#given a child no lifecycle of this host owes a revival #when workflow recovery runs #then its node still fails as orphaned at once", async () => {
    // given - the parent this lifecycle serves is gone, so nothing here will revive the child
    const f = overCapacity()
    const { hang, store } = await reopenOverCapacity(f)
    f.state.live = false

    // when
    const run = await recoverRun(f, store)

    // then
    expect((await run.settled).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:resume_task_orphaned", "k-after:skipped"])
    expect(nodeError(store, "k-hang")).toContain(hang)
  })

  test("#given the child was revived by session-start reconcile #when workflow recovery runs #then the node is attached as before", async () => {
    // given
    const f = fixture("in-process", { default_concurrency: 2 })
    const hang = await f.start()
    await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT, reason: "quit" })
    const store = seedRun(f, { "k-hang": hang })
    f.state.revivable = true
    await f.restart().reconcileOnSessionStart(PARENT)
    expect(f.manager.getResidentHandle(hang)).toBeDefined()

    // when
    const run = await recoverRun(f, store)
    await finishRun(f, store, hang)

    // then
    expect((await run.settled).record?.status).toBe("completed")
    expect(nodeStates(store)).toEqual(["k-hang:completed", "k-after:completed"])
  })
})
