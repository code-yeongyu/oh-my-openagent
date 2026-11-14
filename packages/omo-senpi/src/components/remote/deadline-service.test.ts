import { afterEach, describe, expect, test } from "bun:test"
import { BOUNDS, CONNECT_SLACK_MS, DEADLINES } from "./deadlines"
import { clientOn, closeClients, fakeClock, failureOf, startModeOwner } from "./testing/fake-service"
import type { BootstrapResult } from "./types"

// Deadline rows of service.* (design v8-core r2, B1: L0 request 30,000 beneath, default 35,000) and the cold connect
// (handshake 10,000 + 2,000), all on fake time: the call settles with the table's code within deadline + 500 ms, and an
// aborted signal settles `cancelled` within 100 ms.

afterEach(closeClients)

describe("deadline rows: service.*", () => {
  test("#given a service that never answers #when service.status waits #then the L0 request bound surfaces first, as timeout", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("silent-requests")
    const start = clock.now()
    const settling = clientOn(owner.stateDir, clock).service.status()
    await withheld("response")
    clock.advance(BOUNDS.request)
    const failure = failureOf(await settling)
    expect(failure.code).toBe("timeout")
    expect(failure.details).toMatchObject({ local_api_code: "request_timeout" })
    expect(failure.uncertain).toBeUndefined()
    expect(clock.now() - start).toBeLessThanOrEqual(DEADLINES.service + 500)
    expect(DEADLINES.service).toBeGreaterThan(BOUNDS.request)
  })

  test("#given a deadline below the L0 bound #when service.control waits #then the member's own clock answers timeout at it", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("silent-requests")
    const settling = clientOn(owner.stateDir, clock).service.control({ deadlineMs: 5_000 })
    await withheld("response")
    clock.advance(5_000)
    expect(failureOf(await settling)).toMatchObject({ code: "timeout", details: { deadline_ms: 5_000 } })
  })

  test("#given a mutator that never answers #when service.setEnabled times out #then the timeout is uncertain", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("silent-requests")
    const settling = clientOn(owner.stateDir, clock).service.setEnabled(false)
    await withheld("response")
    clock.advance(DEADLINES.service + 500)
    expect(failureOf(await settling)).toMatchObject({ code: "timeout", uncertain: true })
  })

  test.each(["status", "control", "setControl"] as const)(
    "#given service.%s in flight #when its signal aborts #then it settles cancelled with no fake time spent",
    async (member) => {
      const clock = fakeClock()
      const { owner, withheld } = await startModeOwner("silent-requests")
      const client = clientOn(owner.stateDir, clock)
      const abort = new AbortController()
      const start = clock.now()
      const settling =
        member === "setControl"
          ? client.service.setControl(true, { signal: abort.signal })
          : client.service[member]({ signal: abort.signal })
      await withheld("response")
      abort.abort()
      const failure = failureOf(await settling)
      expect(failure.code).toBe("cancelled")
      expect(failure.uncertain).toBe(member === "setControl" ? true : undefined)
      expect(clock.now() - start).toBeLessThan(100)
    },
  )

  test("#given a service that never welcomes #when the first member connects #then the handshake bound answers host_unavailable before the member clock", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("silent-handshake")
    const start = clock.now()
    const settling = clientOn(owner.stateDir, clock).service.info()
    await withheld("welcome")
    clock.advance(BOUNDS.handshake)
    expect(failureOf(await settling)).toMatchObject({
      code: "host_unavailable",
      details: { local_api_code: "handshake_timeout" },
    })
    expect(clock.now() - start).toBeLessThanOrEqual(BOUNDS.handshake + CONNECT_SLACK_MS + 500)
  })

  test("#given a bootstrap that never ends #when service.bootstrap runs #then it answers an uncertain timeout at 570,000", async () => {
    const clock = fakeClock()
    const { owner } = await startModeOwner("silent-requests")
    const never = (): Promise<BootstrapResult> => new Promise<BootstrapResult>(() => undefined)
    const settling = clientOn(owner.stateDir, clock, undefined, { bootstrap: never }).service.bootstrap({})
    clock.advance(DEADLINES.bootstrap)
    expect(failureOf(await settling)).toMatchObject({ code: "timeout", uncertain: true })
    expect(DEADLINES.bootstrap).toBeLessThan(BOUNDS.bootstrapRunner)
  })
})
