import { afterEach, expect, test } from "bun:test"

import { awaitWithinTestBudget, useTestTimeout } from "../../../../../test-support/test-deadline"
import { LOCAL_DEBOUNCE_MS } from "./engine"
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

// #14476: with the stream connected and nothing advertised past what this device applied, a local commit goes
// straight to the push: the pull before it is two serial requests that can find nothing new, and a peer's batch
// that did land first is still caught by the append's stale_base answer.
test(
  "#given a connected stream and no advertised head past the applied cursor #when a local commit lands #then the engine pushes within the debounce without pulling first",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a")
    const b = await makeDevice(server, "b")
    devices.push(a, b)
    a.engine.start()
    const aStarted = a.engine.nextCycle()
    b.engine.start()
    await Promise.all([aStarted, b.engine.nextCycle()])
    const pullsBefore = server.pulls.filter((author) => author === "device:a").length

    await a.write("x.md", "x\n")
    const pushed = a.engine.nextCycle()
    const received = b.engine.nextCycle()
    a.engine.notifyLocalCommit()
    a.clock.advance(500)
    await awaitWithinTestBudget(pushed, "A's push 500 ms after the commit")
    await awaitWithinTestBudget(received, "B's cycle on the advertised head")

    expect(LOCAL_DEBOUNCE_MS).toBeLessThanOrEqual(500)
    expect(server.pulls.filter((author) => author === "device:a").length).toBe(pullsBefore)
    expect(server.head).toBe(1)
    expect(await b.read("x.md")).toBe("x\n")
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a peer's batch landed but its event has not arrived #when a local commit pushes without pulling #then stale_base pulls the peer's batch and both edits converge",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a")
    const b = await makeDevice(server, "b")
    devices.push(a, b)
    a.engine.start()
    await a.engine.nextCycle()
    server.missAdvanced.add("device:a")
    await b.write("peer.md", "peer\n")
    await b.engine.runCycle()

    await a.write("mine.md", "mine\n")
    const pushed = a.engine.nextCycle()
    a.engine.notifyLocalCommit()
    a.clock.advance(LOCAL_DEBOUNCE_MS)
    // The stale_base answer backs off on the engine's clock before it pulls and retries.
    let settled = false
    void pushed.finally(() => (settled = true))
    while (!settled) {
      await Promise.race([pushed, a.clock.untilPending()])
      a.clock.advance(1_000)
    }
    const report = await awaitWithinTestBudget(pushed, "A's push after the stale base")
    await b.engine.runCycle()

    expect(report.pushed).toBe(true)
    expect([await a.read("peer.md"), await b.read("mine.md")]).toEqual(["peer\n", "mine\n"])
  },
  GIT_TEST_TIMEOUT,
)
