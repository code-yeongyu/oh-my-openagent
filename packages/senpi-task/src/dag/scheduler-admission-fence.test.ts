// #15134 stacked on #15135: an open admission batch admits a node a fold unblocks at once, unless a
// child of the run went stale during the batch. Then the node waits for the next pass, whose fence
// stops the stale child before anything starts, and fails the node when that stop cannot land.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { admissionFixture, cleanupAdmissionRoots } from "./scheduler-admission-e2e.test-harness"
import { drainMicrotasks, settlement, timeout } from "./scheduler-frontier.test-harness"
import { categoryNode } from "./__fixtures__/controlled-dag-e2e"
import { completed, infrastructureFailed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupAdmissionRoots)

// A batch holding S's start open: A's infrastructure failure folds and schedules its retry (raising
// A's attempt), A's old child optionally resumes on its own (stale), then P completes and unblocks D.
async function batchWithFoldUnblockingD(staleChild: "none" | "stoppable" | "unreachable") {
  const h = await admissionFixture("fence-deferral", [
    categoryNode("A"),
    categoryNode("P"),
    categoryNode("S"),
    categoryNode("D", ["P"]),
  ])
  const slowStart = h.starts.hold("S")
  const run = settlement(h.scheduler.run())
  await Promise.race([
    Promise.all([h.runner.whenStarted(2), slowStart.reached]),
    timeout("A and P to start while S's start is held"),
  ])
  const retryScheduled = h.clock.whenScheduled(1)
  h.runner.settle("A", infrastructureFailed("A"))
  await Promise.race([retryScheduled, timeout("A's infrastructure retry to be scheduled")])
  const staleTaskId = h.taskOf("A")
  if (staleChild === "unreachable") h.runner.child("A").connection.lose()
  if (staleChild !== "none") await h.runner.selfResume("A")
  const pFolded = h.whenNode("P", "completed")
  h.runner.settle("P", completed("P"))
  await Promise.race([pFolded, timeout("P's completion to fold")])
  await drainMicrotasks()
  const finish = async (): Promise<void> => {
    slowStart.release()
    h.runner.child("A").connection.reconnect()
    await h.scheduler.cancel(h.runId, "test teardown").catch(() => undefined)
    await Promise.race([run.outcome, timeout("the run to settle after teardown")])
  }
  return { ...h, slowStart, staleTaskId, finish }
}

describe("DAG admission batch defers a fold's admission while a stale child is live (#10057 on #11381)", () => {
  test("#given a child of the run went stale during the batch #when a fold unblocks a node #then the node is not admitted in this batch, and the next pass stops the stale child before the node starts", async () => {
    // given
    const h = await batchWithFoldUnblockingD("stoppable")
    expect(h.fixture.taskStore.load(h.staleTaskId)?.status).toBe("running")
    let staleAtStart: string | undefined
    h.starts.onStart = (nodeId) => {
      if (nodeId === "D") staleAtStart = h.fixture.taskStore.load(h.staleTaskId)?.status
    }

    // then - (a) with S's start still in flight, D was neither scheduled nor started.
    expect(["pending", "blocked"]).toContain(h.node("D")?.state ?? "missing")
    expect(h.starts.calls).not.toContain("D")

    // when - S's start returns and the batch ends.
    h.slowStart.release()
    await Promise.race([h.starts.whenCalled("D"), timeout("D to start after the batch")])

    // then - (b) the next pass stopped the stale child before D's start reached the manager.
    expect(staleAtStart).toBe("cancelled")
    expect(h.starts.calls).toEqual(["A", "P", "S", "D"])
    await h.finish()
  })

  test("#given a stale child whose stop cannot land #when a fold unblocks a node during the batch #then the node fails stale_attempt_alive at the next pass and never starts", async () => {
    // given - the stale child's transport is gone, so its stop stays pending.
    const h = await batchWithFoldUnblockingD("unreachable")
    expect(["pending", "blocked"]).toContain(h.node("D")?.state ?? "missing")

    // when
    const dFailed = h.whenNode("D", "failed")
    h.slowStart.release()
    const first = await Promise.race([
      dFailed.then(() => "failed"),
      h.starts.whenCalled("D").then(() => "D started beside the live stale child"),
      timeout("D to fail at the next pass's fence"),
    ])

    // then - (c)
    expect(first).toBe("failed")
    expect(h.node("D")).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
    expect(h.starts.calls).not.toContain("D")
    expect(h.fixture.taskStore.load(h.staleTaskId)?.status).toBe("running")
    await h.finish()
  })

  test("#given no stale child #when a fold unblocks a node during the batch #then the node starts inside the same batch, while the held start is still in flight", async () => {
    // given
    const h = await batchWithFoldUnblockingD("none")

    // when
    await Promise.race([h.starts.whenCalled("D"), timeout("D to start inside the open batch")])

    // then - (d) S's start has not returned, so D was admitted by this batch, not a later pass.
    expect(h.starts.calls).toEqual(["A", "P", "D"])
    expect(h.runner.startedSpecs.map((spec) => spec.prompt)).not.toContain("do S")
    await h.finish()
  })
})
