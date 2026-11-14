import { afterEach, describe, expect, test } from "bun:test"
import { BOUNDS, DEADLINES } from "./deadlines"
import { clientOn, closeClients, fakeClock, failureOf, startModeOwner } from "./testing/fake-service"

// Deadline row of sessions.list (design v8-core r2, B1: relayd round 10,000 and L0 request 30,000 beneath, default
// 35,000), on fake time.

afterEach(closeClients)

describe("deadline row: sessions.list", () => {
  test("#given a service that never answers the listing #when sessions.list waits #then it settles timeout within the table's deadline", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("silent-requests")
    const start = clock.now()
    const settling = clientOn(owner.stateDir, clock).sessions.list()
    await withheld("response")
    clock.advance(BOUNDS.request)
    expect(failureOf(await settling)).toMatchObject({ code: "timeout", details: { local_api_code: "request_timeout" } })
    expect(clock.now() - start).toBeLessThanOrEqual(DEADLINES.sessionsList + 500)
    expect(DEADLINES.sessionsList).toBeGreaterThan(Math.max(BOUNDS.request, BOUNDS.listingRound))
  })

  test("#given sessions.list in flight #when its signal aborts #then it settles cancelled with no fake time spent", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("silent-requests")
    const abort = new AbortController()
    const start = clock.now()
    const settling = clientOn(owner.stateDir, clock).sessions.list({}, { signal: abort.signal })
    await withheld("response")
    abort.abort()
    expect(failureOf(await settling)).toMatchObject({ code: "cancelled" })
    expect(clock.now() - start).toBeLessThan(100)
  })
})
