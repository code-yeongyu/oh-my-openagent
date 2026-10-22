import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop()
    await d.dispose()
  }
}, GIT_TEST_TIMEOUT)

async function started() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  return { server, a, b }
}

test("startup runs a cycle, and an advertised head beyond the applied cursor triggers the next", async () => {
  const { a, b } = await started()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  const startup = b.engine.nextCycle()
  b.engine.start()
  await startup
  expect(await b.read("x.md")).toBe("x\n")
  const triggered = b.engine.nextCycle()
  await a.write("y.md", "y\n")
  await a.engine.runCycle()
  await triggered
  expect(await b.read("y.md")).toBe("y\n")
  const state = await b.engine.state()
  expect([state.eventHead, state.applied]).toEqual([2, 2])
}, GIT_TEST_TIMEOUT)

test("an advertised head is a trigger only: it never moves the applied cursor", async () => {
  const { server, a, b } = await started()
  b.engine.start()
  await b.engine.nextCycle()
  b.verifier.failing.set(1, "signature")
  const triggered = b.engine.nextCycle()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  await triggered
  expect(server.head).toBe(1)
  expect(await b.engine.state()).toMatchObject({ eventHead: 1, applied: 0, refused: 1 })
}, GIT_TEST_TIMEOUT)

test("while the stream is down the engine polls every 10 s, and stops polling once it reconnects", async () => {
  const { server, a, b } = await started()
  b.engine.start()
  await b.engine.nextCycle()
  server.disconnect()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  expect(await b.read("x.md")).toBeNull()
  const polled = b.engine.nextCycle()
  b.clock.advance(9_999)
  expect(b.engine.cyclesRun).toBe(1)
  b.clock.advance(1)
  await polled
  expect(await b.read("x.md")).toBe("x\n")
}, GIT_TEST_TIMEOUT)

test("a local commit starts a cycle after a 2 s debounce, once for a burst", async () => {
  const { a, b } = await started()
  a.engine.start()
  await a.engine.nextCycle()
  await a.write("x.md", "x\n")
  a.engine.notifyLocalCommit()
  a.clock.advance(1_000)
  await a.write("y.md", "y\n")
  a.engine.notifyLocalCommit()
  a.clock.advance(1_999)
  expect(a.engine.cyclesRun).toBe(1)
  const pushed = a.engine.nextCycle()
  a.clock.advance(1)
  await pushed
  expect(a.engine.cyclesRun).toBe(2)
  await b.engine.runCycle()
  expect([await b.read("x.md"), await b.read("y.md")]).toEqual(["x\n", "y\n"])
}, GIT_TEST_TIMEOUT)
