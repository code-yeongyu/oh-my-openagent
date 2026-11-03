// One memory file over the batch bound must never stop the device's other items from syncing
// (#12284): it is held back whole, named in the status, and synced once it fits again.

import { afterEach, expect, test } from "bun:test"

import { MAX_BATCH_BYTES } from "./batches"
import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { toBase64 } from "./journal"

/** 500 files rendered and committed on the receiver through real git: well past the default per-test bound. */
const LARGE_SET_TIMEOUT = 180_000
const SMALL_SET_TIMEOUT = 60_000

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, SMALL_SET_TIMEOUT)

const BIG_KEY = "archive/oversized/big-export.md"
const normalKeys = Array.from({ length: 500 }, (_, n) => `notes/n${String(n).padStart(3, "0")}.md`)
const normalText = (key: string) => `${key} body\n`

test("one file over 8 MiB is held back and the 500 other files still reach the other device, none of it truncated (#12284)", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  for (const key of normalKeys) await a.write(key, normalText(key))
  await a.write(BIG_KEY, `${"x".repeat(MAX_BATCH_BYTES + 1024 * 1024)}\n`)
  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  await b.engine.runCycle()
  const received = await Promise.all(normalKeys.map((key) => b.read(key)))
  expect(received.filter((text, i) => text === normalText(normalKeys[i] ?? "")).length).toBe(500)
  expect(await b.read(BIG_KEY)).toBeNull()
}, LARGE_SET_TIMEOUT)

test("the held file is named in a shown, typed status on every cycle until it fits, then syncs whole and the status clears", async () => {
  const bound = 4096
  const server = new FakeSyncServer()
  let changes = 0
  const a = await makeDevice(server, "a", undefined, { realStore: true, batchBytes: bound, onStatusChange: () => (changes += 1) })
  const b = await makeDevice(server, "b", undefined, { realStore: true, batchBytes: bound })
  devices.push(a, b)
  const note = (body: string) => `---\ndescription: note\n---\n${body}`
  await a.write("small.md", note("small\n"))
  await a.write("big.md", note(`${"y".repeat(bound * 2)}\n`))
  const heldAt = a.clock.now()
  await a.engine.runCycle()
  const held = {
    kind: "failing",
    since: heldAt,
    failure: { kind: "oversized_item", keys: ["big.md"], limitBytes: bound, reason: expect.any(String), action: expect.stringContaining("big.md") },
  }
  expect(await a.engine.status()).toMatchObject({ ...held, attempts: 1 })
  expect(changes).toBe(1)
  a.clock.advance(10_000)
  await a.engine.runCycle()
  expect(await a.engine.status()).toMatchObject({ ...held, attempts: 2 })
  expect(changes).toBe(1)
  await b.engine.runCycle()
  expect(await b.read("small.md")).toBe(note("small\n"))
  expect(await b.read("big.md")).toBeNull()
  await a.write("big.md", note("now it fits\n"))
  await a.engine.runCycle()
  expect(await a.engine.status()).toMatchObject({ kind: "synced" })
  expect(changes).toBe(2)
  await b.engine.runCycle()
  expect(await b.read("big.md")).toBe(note("now it fits\n"))
}, SMALL_SET_TIMEOUT)

test("an oversized item an older build already journaled is held with every later op of its key, and the rest still pushes", async () => {
  const bound = 1024
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { batchBytes: bound })
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  const ops = (line: string) => toBase64(new TextEncoder().encode(JSON.stringify({ adds: { [line.slice(0, 8)]: line }, kills: [] })))
  const legacy = [{ key: "legacy.md", ops: ops("z".repeat(bound * 2)) }, { key: "legacy.md", ops: ops("later edit") }]
  await a.engine.journal.setPending({ items: legacy, outgoing: null })
  await a.write("fresh.md", "fresh\n")
  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  expect((await a.engine.journal.pending()).items).toEqual(legacy)
  expect(await a.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "oversized_item", keys: ["legacy.md"] } })
  await b.engine.runCycle()
  expect(await b.read("fresh.md")).toBe("fresh\n")
  expect(await b.read("legacy.md")).toBeNull()
}, SMALL_SET_TIMEOUT)
