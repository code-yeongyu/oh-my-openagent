import { afterEach, expect, test } from "bun:test"

import { awaitWithinTestBudget, useTestTimeout } from "../../../../../test-support/test-deadline"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop()
    await d.dispose()
  }
}, GIT_TEST_TIMEOUT)

// #14476: an event stream the service refuses (a lease 429, a 426, a 5xx) must still leave the device polling, on a
// 10 s clock that the transport's 5 s retries never push back; the refusal and the recovery each reach the log once.
test(
  "#given an event stream refused on every attempt #when another device pushes #then the receiver polls it in within 10 s, and the poll stops once the stream connects",
  async () => {
    useTestTimeout(GIT_TEST_TIMEOUT)
    const server = new FakeSyncServer()
    server.streamRefusal = "HTTP 429 rate_limited"
    const lines: string[] = []
    const a = await makeDevice(server, "a")
    const b = await makeDevice(server, "b", undefined, { log: (line) => lines.push(line) })
    devices.push(a, b)
    b.engine.start()
    await b.engine.nextCycle()
    await a.write("x.md", "x\n")
    await a.engine.runCycle()

    b.clock.advance(5_000)
    server.refuseStreamRetry()
    expect(b.engine.cyclesRun).toBe(1)
    const polled = b.engine.nextCycle()
    b.clock.advance(5_000)
    await awaitWithinTestBudget(polled, "the poll 10 s after the first refused connect")

    expect(await b.read("x.md")).toBe("x\n")

    server.connectStreams()
    b.clock.advance(30_000)
    expect(b.engine.cyclesRun).toBe(2)
    expect(lines.filter((line) => line.startsWith("sync event stream"))).toEqual([
      "sync event stream down (HTTP 429 rate_limited), polling every 10 s",
      "sync event stream connected",
    ])
  },
  GIT_TEST_TIMEOUT,
)
