// #15150 on the merged base (#15125): a node waiting for its child's pending revival is an ACTIVE node.
// A re-entry (retry, amend) is refused run_still_active naming it, the run is never parked as having
// unattached nodes while only waiting nodes are active, and a cancel still ends the run and the child.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import {
  cleanupPendingRevivalRuns,
  nodeStates,
  PARENT,
  recoverRun,
  reopenOverCapacity,
} from "./__fixtures__/pending-revival-run"
import { runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
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

/** The verb's refusal, whether it throws synchronously or rejects. */
async function refusalOf(verb: () => unknown): Promise<unknown> {
  try {
    await verb()
  } catch (error) {
    return error
  }
  throw new Error("the verb was not refused")
}

describe("a run whose only active node waits for its child's revival (#15150 on #15125)", () => {
  test("#given a waiting node #when a retry re-enters the running run #then it is refused run_still_active and the run is not parked", async () => {
    // given
    const f = overCapacity()
    const { store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    f.advance(5_000)

    // when
    const refusal = await refusalOf(() => run.scheduler.retryNode(runId, ["k-hang" as DagNodeId]))

    // then
    expect(refusal).toMatchObject({ code: "run_still_active" })
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("running")
    expect(store.readEvents(runId, 0, { limit: 500 }).events.some((event) => event.type === "dag.run.paused")).toBe(
      false,
    )
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])
    await run.scheduler.suspend()
  })

  test("#given a run parked while its node waits #when a retry re-enters it #then it is refused run_still_active naming the waiting node", async () => {
    // given - the session goes down: the waiting node is released and the run parks with it still active
    const f = overCapacity()
    const { store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT, reason: "quit" })
    expect((await run.settled).record?.status).toBe("paused")

    // when
    const refusal = await refusalOf(() => run.scheduler.retryNode(runId, ["k-hang" as DagNodeId]))

    // then
    expect(refusal).toMatchObject({ code: "run_still_active", nodeIds: ["k-hang"] })
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])
  })

  test("#given a waiting node #when the run is cancelled #then the run and its node end cancelled and the lifecycle owes the child nothing", async () => {
    // given
    const f = overCapacity()
    const { hang, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)

    // when
    await run.scheduler.cancel(runId, "user cancelled")

    // then
    expect((await run.settled).record?.status).toBe("cancelled")
    expect(nodeStates(store)).toEqual(["k-hang:cancelled", "k-after:cancelled"])
    expect(f.store.load(hang)?.status).toBe("cancelled")
    expect(f.lifecycle.pendingRevivals?.obligation(hang)).toBe("none")
  })
})
