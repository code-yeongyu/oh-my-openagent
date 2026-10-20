import { afterEach, expect, test } from "bun:test"

import { ACCOUNT, type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { encodePayload } from "./fake-crypto.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import type { FakeItemStore } from "./fake-store.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const DAY = 24 * 60 * 60 * 1000

test("a device offline for 40 fixture days catches up from the snapshot and later entries, keeping its own edit", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  await a.write("journal.md", "day 0\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await b.write("offline.md", "written offline\n")
  await b.write("journal.md", "day 0\nb offline\n")
  const expected = ["day 0"]
  for (let day = 1; day <= 40; day += 1) {
    a.clock.advance(DAY)
    expected.push(`day ${String(day).padStart(2, "0")}`)
    await a.write("journal.md", `${expected.join("\n")}\n`)
    await a.engine.runCycle()
  }
  // The server keeps 30 days: everything older is compacted into a snapshot a device built.
  const cutoff = server.head - 30
  server.compact(cutoff, encodePayload(ACCOUNT, `snapshot-${cutoff}`, cutoff, (a.store as FakeItemStore).snapshotPayload()))
  expect(server.entries[0]?.seq).toBe(cutoff + 1)
  const report = await b.engine.runCycle()
  expect(report).toMatchObject({ refused: 0, snapshot: cutoff, pushed: true })
  const merged = [...expected, "b offline"].sort()
  expect(await b.read("journal.md")).toBe(`${merged.join("\n")}\n`)
  expect(await b.read("offline.md")).toBe("written offline\n")
  await a.engine.runCycle()
  expect(await a.read("journal.md")).toBe(`${merged.join("\n")}\n`)
  expect(await a.read("offline.md")).toBe("written offline\n")
}, GIT_TEST_TIMEOUT)
