import { afterEach, describe, expect, test } from "bun:test"
import { BOUNDS, DEADLINES } from "./deadlines"
import { clientOn, closeClients, fakeClock, failureOf, startModeOwner } from "./testing/fake-service"

// Deadline rows of devices.* (design v8-core r2, B1: L0 request 30,000 beneath, default 35,000), on fake time.

afterEach(closeClients)

describe("deadline rows: devices.*", () => {
  test.each(["list", "resolve"] as const)(
    "#given a service that never answers #when devices.%s waits #then it settles timeout within the table's deadline",
    async (member) => {
      const clock = fakeClock()
      const { owner, withheld } = await startModeOwner("silent-requests")
      const client = clientOn(owner.stateDir, clock)
      const start = clock.now()
      const settling = member === "list" ? client.devices.list() : client.devices.resolve("Studio")
      await withheld("response")
      clock.advance(BOUNDS.request)
      expect(failureOf(await settling)).toMatchObject({
        code: "timeout",
        details: { local_api_code: "request_timeout" },
      })
      expect(clock.now() - start).toBeLessThanOrEqual(DEADLINES.devices + 500)
    },
  )

  test.each(["list", "resolve"] as const)(
    "#given devices.%s in flight #when its signal aborts #then it settles cancelled with no fake time spent",
    async (member) => {
      const clock = fakeClock()
      const { owner, withheld } = await startModeOwner("silent-requests")
      const client = clientOn(owner.stateDir, clock)
      const abort = new AbortController()
      const start = clock.now()
      const settling =
        member === "list"
          ? client.devices.list({ signal: abort.signal })
          : client.devices.resolve("Studio", { signal: abort.signal })
      await withheld("response")
      abort.abort()
      expect(failureOf(await settling).code).toBe("cancelled")
      expect(clock.now() - start).toBeLessThan(100)
    },
  )
})
