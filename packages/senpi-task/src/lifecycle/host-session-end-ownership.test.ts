import { afterEach, describe, expect, test } from "bun:test"

import { cancelHarness, eventsOf, within } from "./__fixtures__/host-session-cancel-harness"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

// A macrotask boundary: every microtask chain run N's settle started has finished by then (the store writes are synchronous).
const drainMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

// Contract (#11783 review): an end check belongs to one run of a task. No entrant - the end port, a cancel and its
// driver, the destruction port - joins or doubles another run's in-flight check, and that run's late close never
// finishes a later run's cancel.

function runNWithPendingClose(taskId: string) {
  let opens = 0
  const answer = Promise.withResolvers<void>()
  const harness = cancelHarness({ taskId, deferredRetryBackoffMs: [10], deps: { hostCloseTimeoutMs: 0, hostSessionClose: () => {
    opens += 1
    return answer.promise
  } } })
  harness.fixture.daemon.hold(harness.record.host_session?.session_path ?? "missing session path")
  return { harness, answer, opens: () => opens }
}

function bumpRun(harness: ReturnType<typeof cancelHarness>): void {
  harness.store.mutate(harness.record.task_id, (fresh) => ({ ...fresh, notification: { ...fresh.notification, run_epoch: fresh.notification.run_epoch + 1 } }))
}

describe("an end check is never shared across runs of one task", () => {
  test("#given run N's close is in flight #when the end port is asked about run N+1 #then it answers earlier_run_in_flight and opens nothing", async () => {
    // given
    const { harness, opens } = runNWithPendingClose("st_0e000001")
    const port = harness.lifecycle.hostSessionCancel
    if (port === undefined) throw new Error("the lifecycle exposes no host-session cancel")
    expect((await port.end(harness.record)).kind).toBe("pending")
    bumpRun(harness)
    const runN1 = harness.store.load("st_0e000001") ?? harness.record

    // when
    const end = await port.end(runN1)

    // then
    expect(end).toEqual({ kind: "not_ended", reason: "earlier_run_in_flight" })
    expect(opens()).toBe(1)
  })

  test("#given run N's close is in flight and run N+1's cancel driver is parked in its backoff #when run N's close succeeds #then run N+1 is still running", async () => {
    // given
    const reachedWait = Promise.withResolvers<void>()
    const backoff = Promise.withResolvers<void>()
    let opens = 0
    const answer = Promise.withResolvers<void>()
    const harness = cancelHarness({ taskId: "st_0e000002", deferredRetryBackoffMs: [10], onWait: () => reachedWait.resolve(), gateWait: () => backoff.promise,
      deps: { hostCloseTimeoutMs: 0, hostSessionClose: () => {
        opens += 1
        return answer.promise
      } } })
    harness.fixture.daemon.hold(harness.record.host_session?.session_path ?? "missing session path")
    const port = harness.lifecycle.hostSessionCancel
    if (port === undefined) throw new Error("the lifecycle exposes no host-session cancel")
    const runN = await port.end(harness.record)
    if (runN.kind !== "pending") throw new Error(`run N's end should be pending, got ${runN.kind}`)
    bumpRun(harness)
    const outcome = await harness.engine.cancelTask("st_0e000002")
    await within(reachedWait.promise, "run N+1's driver reaching its backoff wait")

    // when
    answer.resolve()
    expect(await within(runN.settled, "run N's close settling")).toBe(true)
    await drainMicrotasks()

    // then
    expect(outcome).toMatchObject({ kind: "cancel_pending", reason: "earlier_run_in_flight" })
    expect(harness.store.load("st_0e000002")?.status).toBe("running")
    expect(eventsOf(harness, "cancelled")).toEqual([])
    expect(opens).toBe(1)
    const settled = harness.nextSettlement()
    backoff.resolve()
    await within(settled, "run N+1's driver settling after its backoff")
  })

  test("#given run N's close is in flight #when the destruction port cancels run N+1 #then it opens nothing", async () => {
    // given
    const { harness, opens } = runNWithPendingClose("st_0e000003")
    const port = harness.lifecycle.hostSessionCancel
    if (port === undefined) throw new Error("the lifecycle exposes no host-session cancel")
    await port.end(harness.record)
    bumpRun(harness)

    // when
    await harness.lifecycle.destroyResidentTask("st_0e000003", "cancel")

    // then
    expect(opens()).toBe(1)
  })
})
