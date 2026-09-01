import { describe, expect, test } from "bun:test"
import { fireTimer, fixture, NOW_MS } from "./dream-trigger.test-support"

describe("dream session_start reconcile", () => {
  test("#given an overdue identity #when session_start reconcile arms and fires #then a dream launches through the idle path", async () => {
    const f = await fixture({ lastDreamAt: new Date(NOW_MS - 25 * 3_600_000).toISOString() })

    await f.wiring.reconcileSessionStart(f.session)

    expect(f.scheduler.latest().delayMs).toBe(60_000)
    await fireTimer(f)

    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.request.origin).toBe("idle")
  })

  test("#given a recent dream #when session_start reconcile runs #then no timer or dream is created", async () => {
    const f = await fixture({ lastDreamAt: new Date(NOW_MS - 1_000).toISOString() })

    await f.wiring.reconcileSessionStart(f.session)

    expect(f.scheduler.scheduled).toHaveLength(0)
    expect(f.launches).toHaveLength(0)
  })

  test("#given dreams are disabled #when session_start reconcile runs #then no timer or dream is created", async () => {
    const f = await fixture({ settings: { enabled: false } })

    await f.wiring.reconcileSessionStart(f.session)

    expect(f.scheduler.scheduled).toHaveLength(0)
    expect(f.launches).toHaveLength(0)
  })

  test("#given an overdue identity #when input arrives before reconcile fires #then the pending timer is cancelled", async () => {
    const f = await fixture({ lastDreamAt: new Date(NOW_MS - 25 * 3_600_000).toISOString() })

    await f.wiring.reconcileSessionStart(f.session)
    await f.pi.dispatch("input", {}, f.eventCtx)
    await fireTimer(f)

    expect(f.launches).toHaveLength(0)
    expect(f.scheduler.latest().cancelled).toBe(true)
  })
})
