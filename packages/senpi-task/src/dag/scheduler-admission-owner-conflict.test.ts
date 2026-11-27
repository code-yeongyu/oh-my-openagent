// #15134 stacked on #15135: a start that returns owner_conflict stops its node's superseded claim
// inside that start's own in-flight step, so the admission batch - which cancel and suspend wait
// for - stays open until the stop has answered, and the node is settled once through the batch.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { admissionFixture, cleanupAdmissionRoots } from "./scheduler-admission-e2e.test-harness"
import { drainMicrotasks, settlement, timeout } from "./scheduler-frontier.test-harness"
import { categoryNode } from "./__fixtures__/controlled-dag-e2e"
import { infrastructureFailed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupAdmissionRoots)

const SUPERSEDED_STOP = "superseded by a newer attempt of its DAG node"

// A's child fails on infrastructure; its automatic retry's start is held at the gate while the old
// child resumes on its own, so the released start meets a live superseded claim: owner_conflict.
async function retryStartBesideLiveStaleClaim(options: { readonly sibling: boolean }) {
  const h = await admissionFixture(
    "owner-conflict-latch",
    options.sibling ? [categoryNode("A"), categoryNode("B")] : [categoryNode("A")],
  )
  const sibling = options.sibling ? h.starts.hold("B") : undefined
  const retryStart = h.starts.hold("A", 2)
  const run = settlement(h.scheduler.run())
  await Promise.race([h.runner.whenStarted(1), timeout("A's first child to start")])
  const retryScheduled = h.clock.whenScheduled(1)
  h.runner.settle("A", infrastructureFailed("A"))
  await Promise.race([retryScheduled, timeout("A's infrastructure retry to be scheduled")])
  const staleTaskId = h.taskOf("A")
  h.clock.advance()
  await Promise.race([retryStart.reached, timeout("A's retry start to reach the gate")])
  await h.runner.selfResume("A")
  const finish = async (): Promise<void> => {
    h.starts.failNodeLookups = undefined
    sibling?.release()
    await h.scheduler.cancel(h.runId, "test teardown").catch(() => undefined)
    await Promise.race([run.outcome, timeout("the run to settle after teardown")])
  }
  return { ...h, run, sibling, retryStart, staleTaskId, finish }
}

async function supersededStopHeld() {
  const h = await retryStartBesideLiveStaleClaim({ sibling: false })
  const stop = h.runner.child("A").holdStops()
  h.retryStart.release()
  await Promise.race([stop.reached, timeout("the superseded claim's stop to be sent")])
  expect(h.starts.stopRequests).toEqual([{ taskId: h.staleTaskId, reason: SUPERSEDED_STOP }])
  return { ...h, stop }
}

describe("DAG admission latch covers an owner conflict's superseded stop (#10057 on #11381)", () => {
  test("#given an owner conflict whose superseded stop is held #when the run is cancelled #then the cancel waits for the stop, then settles with no live child", async () => {
    // given
    const h = await supersededStopHeld()

    // when
    const cancel = settlement(h.scheduler.cancel(h.runId, "operator stop"))
    await drainMicrotasks()

    // then - the batch still owns the stop: the cancel has not started stopping the run's children.
    expect(cancel.state.settled).toBe(false)
    expect(h.starts.stopRequests.filter((request) => request.reason === "operator stop")).toEqual([])
    h.stop.release()
    expect(await Promise.race([cancel.outcome, timeout("the cancel to settle")])).toBe("completed")
    expect(h.liveChildren()).toEqual([])
    expect(h.scheduler.snapshot().status).toBe("cancelled")
    await Promise.race([h.run.outcome, timeout("the run to settle")])
  })

  test("#given an owner conflict whose superseded stop is held #when the run is suspended #then the suspend waits for the stop, which lands", async () => {
    // given
    const h = await supersededStopHeld()

    // when
    const suspend = settlement(h.scheduler.suspend())
    await drainMicrotasks()

    // then
    expect(suspend.state.settled).toBe(false)
    h.stop.release()
    expect(await Promise.race([suspend.outcome, timeout("the suspend to settle")])).toBe("completed")
    expect(h.fixture.taskStore.load(h.staleTaskId)?.status).toBe("cancelled")
    await Promise.race([h.run.outcome, timeout("the run to settle")])
  })

  test("#given an owner conflict whose superseded stop lands #when the batch handles the start #then the node is settled once, failing stale_attempt_alive, and nothing is adopted", async () => {
    // given
    const h = await supersededStopHeld()

    // when
    h.stop.release()
    await Promise.race([h.run.outcome, timeout("the run to settle")])

    // then
    expect(h.node("A")).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
    expect(h.node("A")?.error?.message).toContain("has been stopped")
    const events = h.fixture.events(h.runId)
    const retried = events.findLastIndex((event) => event.type === "dag.node.retried")
    const afterRetry = events.slice(retried + 1)
    expect(afterRetry.filter((event) => event.type === "dag.node.transitioned" && event.to === "failed")).toHaveLength(
      1,
    )
    expect(afterRetry.filter((event) => event.type === "dag.node.task-attached")).toEqual([])
    expect(h.liveChildren()).toEqual([])
  })

  test("#given a sibling start in flight #when the owner conflict's stop step fails #then that is the batch's first error: the run rejects with it after the sibling returns, and the sibling is not handled", async () => {
    // given
    const h = await retryStartBesideLiveStaleClaim({ sibling: true })
    h.starts.failNodeLookups = new Error("injected owned-task lookup fault")

    // when
    h.retryStart.release()
    await drainMicrotasks()

    // then - the sibling's start still holds the batch open.
    expect(h.run.state.settled).toBe(false)
    h.sibling?.release()
    expect(await Promise.race([h.run.outcome, timeout("the run to settle")])).toBe(
      "rejected: injected owned-task lookup fault",
    )
    await Promise.race([h.starts.whenCalled("B"), timeout("B's start to return")])
    await drainMicrotasks()
    expect(h.fixture.events(h.runId).filter((event) => event.type === "dag.node.task-attached")).toHaveLength(1)
    expect(h.node("B")?.state).toBe("scheduled")
    await h.finish()
  })
})
