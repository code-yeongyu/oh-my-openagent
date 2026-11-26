import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { OFFLINE_SHOWN_AFTER_ATTEMPTS } from "./failure"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const failedCycle = (device: Device): Promise<unknown> =>
  device.engine.runCycle().then(
    () => null,
    (error: unknown) => error,
  )

/** Device b has synced once (with nothing to receive) and device a is about to write. */
async function pair() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  return { server, a, b }
}

async function writeAndPush(device: Device, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await device.write(`${name}.md`, `${name}\n`)
    await device.engine.runCycle()
  }
}

test(
  "#given a device that has never synced #when its first cycle applies another device's memories #then the status carries no offline count",
  async () => {
    const { a, b } = await pair()
    await writeAndPush(a, ["one", "two"])
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now() })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a device that synced before #when a new engine starts and catches up #then the status counts the memories the catch-up updated until entries arrive with no gap",
  async () => {
    const { a, b } = await pair()
    await b.engine.runCycle()
    await writeAndPush(a, ["one", "two", "three"])
    await b.restart()
    b.clock.advance(60_000)
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 3 })
    // A later cycle that receives nothing says nothing new about what was received: the count stays.
    b.clock.advance(1_000)
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 3 })
    // Entries received while this device is online end it.
    await writeAndPush(a, ["four"])
    b.clock.advance(1_000)
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now() })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a returning engine with nothing new to receive #when its first cycle completes #then the offline count is zero",
  async () => {
    const { b } = await pair()
    await b.engine.runCycle()
    await b.restart()
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 0 })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a running engine whose status shows offline #when the service answers again #then the memories that cycle applies are the offline count",
  async () => {
    const { server, a, b } = await pair()
    await b.engine.runCycle()
    server.unreachable.add("device:b")
    for (let attempt = 1; attempt <= OFFLINE_SHOWN_AFTER_ATTEMPTS; attempt += 1) await failedCycle(b)
    expect(await b.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "offline" } })
    await writeAndPush(a, ["one", "two"])
    server.unreachable.delete("device:b")
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 2 })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given failed cycles below the offline threshold #when the next cycle applies memories #then no offline count is reported",
  async () => {
    const { server, a, b } = await pair()
    await b.engine.runCycle()
    server.unreachable.add("device:b")
    for (let attempt = 1; attempt < OFFLINE_SHOWN_AFTER_ATTEMPTS; attempt += 1) await failedCycle(b)
    await writeAndPush(a, ["one"])
    server.unreachable.delete("device:b")
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now() })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a catch-up paused at a refused entry #when the refusal clears #then the count adds up every cycle since the gap opened",
  async () => {
    const { a, b } = await pair()
    await b.engine.runCycle()
    await writeAndPush(a, ["one", "two"])
    await b.restart()
    b.verifier.failing.set(2, "signature")
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "paused", seq: 2, code: "signature" })
    expect(await b.read("one.md")).toBe("one\n")
    b.verifier.failing.clear()
    await b.engine.runCycle()
    expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 2 })
  },
  GIT_TEST_TIMEOUT,
)
