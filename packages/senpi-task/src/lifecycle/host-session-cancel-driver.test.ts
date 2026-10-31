import { afterEach, describe, expect, test } from "bun:test"

import { cancelHarness, eventsOf, within } from "./__fixtures__/host-session-cancel-harness"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

// Contract (omo#11765): a no-handle cancel that did not end on its first pass is re-driven on the injected
// backoff until it ends, and every exit but an engine dispose settles the stop exactly once.

const drainMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe("the host-session cancel driver", () => {
  test("#given the named generation exits during the first backoff #when the driver retries #then the child is cancelled and the stop settles once", async () => {
    // given
    let harnessView: { present: boolean } | undefined
    const harness = cancelHarness({ taskId: "st_0d000001", deferredRetryBackoffMs: [10, 20], onWait: () => {
      if (harnessView !== undefined) harnessView.present = false
    } })
    harnessView = harness.view
    const destroyed = harness.nextEvent("destroyed")

    // when
    const outcome = await harness.engine.cancelTask("st_0d000001")
    await within(destroyed, "the retried cancel's destroyed event")
    await drainMicrotasks()

    // then
    expect(outcome.kind).toBe("cancel_pending")
    expect(harness.store.load("st_0d000001")?.status).toBe("cancelled")
    expect(harness.fixture.waits).toEqual([10])
    expect(harness.stopSettlements).toEqual(["st_0d000001"])
  })

  test("#given the engine is disposed during a backoff #when the wait ends #then the driver stops without another pass and without settling", async () => {
    // given
    let dispose = (): void => undefined
    const harness = cancelHarness({ taskId: "st_0d000002", deferredRetryBackoffMs: [10, 20], onWait: () => dispose() })
    dispose = () => harness.lifecycle.dispose?.()
    const passesBefore = (): number => harness.view.presentCalls

    // when
    await harness.engine.cancelTask("st_0d000002")
    const afterCancel = passesBefore()
    await drainMicrotasks()

    // then
    expect(harness.fixture.waits).toEqual([10])
    expect(harness.view.presentCalls).toBe(afterCancel)
    expect(harness.stopSettlements).toEqual([])
  })

  for (const [exit, act] of [
    ["the parent session shuts down", (harness: ReturnType<typeof cancelHarness>) => { void harness.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" }) }],
    ["another entrant finished the cancel", (harness: ReturnType<typeof cancelHarness>) => { harness.store.transition("st_0d000003", { type: "cancel", timestamp: "2026-10-29T00:00:00.000Z" }) }],
    ["the record is gone", (harness: ReturnType<typeof cancelHarness>) => harness.store.remove("st_0d000003")],
  ] as const) {
    test(`#given ${exit} during a backoff #when the wait ends #then the driver stops and settles the stop once`, async () => {
      // given
      let onWait = (): void => undefined
      const harness = cancelHarness({ taskId: "st_0d000003", deferredRetryBackoffMs: [10, 20], onWait: () => onWait() })
      onWait = () => act(harness)
      const settled = harness.nextSettlement()

      // when
      await harness.engine.cancelTask("st_0d000003")
      await within(settled, "the driver's settlement")
      await drainMicrotasks()

      // then
      expect(harness.fixture.waits).toEqual([10])
      expect(harness.stopSettlements).toEqual(["st_0d000003"])
      expect(eventsOf(harness, "destroyed")).toEqual([])
    })
  }

  test("#given a close that never answers #when the backoff runs out #then the session was opened once and the stop settles once", async () => {
    // given
    const never = new Promise<void>(() => undefined)
    let closes = 0
    const harness = cancelHarness({ taskId: "st_0d000004", deferredRetryBackoffMs: [10, 20], deps: { hostCloseTimeoutMs: 0, hostSessionClose: () => {
      closes += 1
      return never
    } } })
    harness.fixture.daemon.hold(harness.record.host_session?.session_path ?? "")
    const settled = harness.nextSettlement()

    // when
    const outcome = await harness.engine.cancelTask("st_0d000004")
    await within(settled, "the exhausted driver's settlement")

    // then
    expect(outcome).toMatchObject({ kind: "cancel_pending", reason: "close_pending" })
    expect(closes).toBe(1)
    expect(harness.fixture.waits).toEqual([10, 20])
    expect(harness.stopSettlements).toEqual(["st_0d000004"])
  })

  test("#given a close that answers only after the backoff ran out #when it answers #then the cancel finishes in-process with one close event and no second settlement", async () => {
    // given
    const answer = Promise.withResolvers<void>()
    const harness = cancelHarness({ taskId: "st_0d000005", deferredRetryBackoffMs: [10], deps: { hostCloseTimeoutMs: 0, hostSessionClose: () => answer.promise } })
    harness.fixture.daemon.hold(harness.record.host_session?.session_path ?? "")
    const settled = harness.nextSettlement()
    await harness.engine.cancelTask("st_0d000005")
    await within(settled, "the exhausted driver's settlement")
    const destroyed = harness.nextEvent("destroyed")

    // when
    answer.resolve()
    await within(destroyed, "the late close's destroyed event")

    // then
    expect(harness.store.load("st_0d000005")?.status).toBe("cancelled")
    expect(eventsOf(harness, "host_session_closed")).toHaveLength(1)
    expect(harness.stopSettlements).toEqual(["st_0d000005"])
  })

  test("#given the first end pass throws #when task_cancel runs #then it answers end_failed and the driver's fresh pass ends the child", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0d000006", deferredRetryBackoffMs: [10] })
    harness.view.failNext = new Error("EIO: daemon dir unreadable")
    harness.view.present = false
    const destroyed = harness.nextEvent("destroyed")

    // when
    const outcome = await harness.engine.cancelTask("st_0d000006")
    await within(destroyed, "the driver's destroyed event")
    await drainMicrotasks()

    // then
    expect(outcome).toMatchObject({ kind: "cancel_pending", reason: "end_failed" })
    expect(harness.store.load("st_0d000006")?.status).toBe("cancelled")
    expect(harness.stopSettlements).toEqual(["st_0d000006"])
  })
})
