import { afterEach, expect, spyOn, test } from "bun:test"

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

for (const { name, stop } of [
  { name: "reruns when not stopped", stop: false },
  { name: "does not rerun once stopped", stop: true },
]) test(`a local commit queued during a successful cycle ${name} (omo #11057)`, async () => {
  // given: hold a successful push after its capture, with no stream or poll subscribed
  const { server, a, b } = await started()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  server.beforeNextAppend = async () => {
    entered.resolve()
    await release.promise
  }
  await a.write("first.md", "first\n")
  const first = a.engine.runCycle()
  let stopped: Promise<void> | null = null
  try {
    await entered.promise

    // when: another local commit requests a cycle while the first push is in flight
    await a.write("later.md", "later\n")
    await a.repo.commit(["later.md"], "local edit during sync")
    a.engine.notifyLocalCommit()
    a.clock.advance(LOCAL_DEBOUNCE_MS)
    if (stop) stopped = a.engine.stop()
  } finally {
    release.resolve()
  }
  expect((await first).pushed).toBe(true)

  // then: the queued cycle pushes the later commit without another trigger, unless stopped
  if (stopped !== null) {
    await stopped
    expect(a.engine.cyclesRun).toBe(1)
    expect(server.head).toBe(1)
  } else {
    const completion = Promise.withResolvers<void>()
    const deadline = setTimeout(() => completion.reject(new Error("queued successful cycle did not rerun")), GIT_TEST_TIMEOUT)
    try {
      await Promise.race([a.engine.nextCycle(), completion.promise])
    } finally {
      clearTimeout(deadline)
    }
    expect(a.engine.cyclesRun).toBe(2)
    expect(server.head).toBe(2)
    await b.engine.runCycle()
    expect(await b.read("later.md")).toBe("later\n")
  }
}, GIT_TEST_TIMEOUT * 2)

test("a stream-connected device's own pushed head echoed back during its cycle starts no extra cycle (omo #11057)", async () => {
  // given: a started device subscribed to the stream; the server echoes every append to every listener, the pusher too
  const { a } = await started()
  a.engine.start()
  await a.engine.nextCycle()
  expect(a.engine.cyclesRun).toBe(1)

  // when: a local commit is pushed by the debounced cycle
  await a.write("x.md", "x\n")
  const pushed = a.engine.nextCycle()
  a.engine.notifyLocalCommit()
  a.clock.advance(LOCAL_DEBOUNCE_MS)
  expect((await pushed).pushed).toBe(true)

  // then: the echo of its own head, already applied by that cycle, queues nothing; stop() drains any cycle that did start
  await a.engine.stop()
  expect(a.engine.cyclesRun).toBe(2)
}, GIT_TEST_TIMEOUT)

test("a cycle that fails settles nextCycle() with that failure, and a request queued while it ran still gets its cycle (omo #10637)", async () => {
  const { b } = await started()
  await b.restart()
  const failure = new Error("store unavailable")
  let loads = 0
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let rerunStarted = (): void => undefined
  const rerun = new Promise<void>((resolve) => {
    rerunStarted = resolve
  })
  const load = spyOn(b.store, "load").mockImplementation(async () => {
    loads += 1
    if (loads === 1) await gate
    else rerunStarted()
    throw failure
  })
  const waiter = b.engine.nextCycle().then(() => null, (error: unknown) => error)
  const first = b.engine.runCycle().then(() => null, (error: unknown) => error)
  b.engine.notifyLocalCommit()
  b.clock.advance(LOCAL_DEBOUNCE_MS)
  release()

  expect(await first).toBe(failure)
  expect(await waiter).toBe(failure)
  const rerunWithin = await Promise.race([
    rerun.then(() => "ran"),
    new Promise<string>((resolve) => setTimeout(() => resolve("the queued request never got a cycle within 5 s"), 5_000)),
  ])
  expect(rerunWithin).toBe("ran")
  load.mockRestore()
}, GIT_TEST_TIMEOUT)

test("a request queued during a failing cycle never starts a cycle after stop() returns (omo #10637 review of #10971, HIGH)", async () => {
  const { b } = await started()
  await b.restart()
  let loads = 0
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const load = spyOn(b.store, "load").mockImplementation(async () => {
    loads += 1
    if (loads === 1) await gate
    throw new Error("store unavailable")
  })
  const first = b.engine.runCycle().then(() => null, (error: unknown) => error)
  b.engine.notifyLocalCommit()
  b.clock.advance(LOCAL_DEBOUNCE_MS)

  const stopped = b.engine.stop()
  release()
  await stopped
  const loadsAtStop = loads
  await first

  expect(loadsAtStop).toBe(1)
  expect(loads).toBe(1)
  load.mockRestore()
}, GIT_TEST_TIMEOUT)
