import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #14481: one device signs out of account A and signs in to account B over the same memory repository and
// device state dir. The space id comes from the binding and the device peer from the machine, so neither
// changes; the journal (applied cursor, outbox, item docs) built on A's chain must not be resumed on B's.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: account switch note\n---\n${body}`

async function settle(...ds: Device[]): Promise<void> {
  for (let round = 0; round < 3; round += 1) for (const d of ds) await d.engine.runCycle()
}

const SETTLE_LIMIT_MS = 10_000

async function settleWithin(what: string, ...ds: Device[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`waited ${SETTLE_LIMIT_MS} ms for ${what}; it never settled`)),
      SETTLE_LIMIT_MS,
    )
  })
  try {
    await Promise.race([settle(...ds), limit])
  } finally {
    clearTimeout(timer)
  }
}

test(
  "#given a device that synced on account A #when it signs in to account B on the same repository #then its first push on B succeeds and B carries only what it writes after the switch",
  async () => {
    const serverA = new FakeSyncServer()
    const serverB = new FakeSyncServer()
    const d = await makeDevice(serverA, "d", undefined, { realStore: true, account: "acc_a" })
    const peerOnA = await makeDevice(serverA, "a2", undefined, { realStore: true, account: "acc_a" })
    const e = await makeDevice(serverB, "e", undefined, { realStore: true, account: "acc_b" })
    devices.push(d, peerOnA, e)
    for (const name of ["one", "two", "three"]) {
      await d.write(`${name}.md`, note(`${name} on a\n`))
      await d.engine.runCycle()
    }
    await settle(d, peerOnA)
    expect(serverA.head).toBeGreaterThan(serverB.head)
    const headOfA = serverA.head

    await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
    await d.write("after-switch.md", note("written on b\n"))
    await settleWithin("the first cycles on account B", d, e)

    expect(await e.read("after-switch.md")).toBe(note("written on b\n"))
    for (const name of ["one", "two", "three"]) expect(await e.read(`${name}.md`)).toBeNull()
    expect(serverA.head).toBe(headOfA)
    expect(await peerOnA.read("after-switch.md")).toBeNull()
  },
  GIT_TEST_TIMEOUT,
)
