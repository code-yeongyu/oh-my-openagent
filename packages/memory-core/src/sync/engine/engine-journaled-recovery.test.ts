// A crash between journaling a capture and importing it (#12284 review, gate rounds 2-3) leaves the
// device exactly where a crash after importing would: the journaled op is in the doc and the baseline
// is the captured text, so a later revert or delete still reaches the peer. A journaled op this device
// cannot import is left alone, never sent, and never fails the cycle.

import { afterEach, expect, test } from "bun:test"

import { loadLoroRuntime } from "../../crdt/loro-runtime"
import { CrashInjected } from "./engine"
import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { toBase64 } from "./journal"

const TIMEOUT = 60_000

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, TIMEOUT)

const note = (body: string) => `---\ndescription: note\n---\n${body}`
const crashAtCaptured = (at: string) => {
  if (at === "captured") throw new CrashInjected(at)
}

async function pair() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  return { a, b }
}

test("a revert to the exact pre-edit text after a crash between journaling and importing the edit reaches the peer", async () => {
  const { a, b } = await pair()
  await a.write("n.md", note("first\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("n.md", note("first\nedit\n"))
  await a.restart(crashAtCaptured)
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await a.restart()
  await a.write("n.md", note("first\n"))
  await a.engine.runCycle()
  expect(await a.engine.status()).toMatchObject({ kind: "synced" })
  await b.engine.runCycle()
  expect(await b.read("n.md")).toBe(note("first\n"))
  expect(await a.read("n.md")).toBe(note("first\n"))
}, TIMEOUT)

test("deleting a new file whose creation crashed between journaling and importing reaches the peer as a delete", async () => {
  const { a, b } = await pair()
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("new.md", note("brand new\n"))
  await a.restart(crashAtCaptured)
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await a.restart()
  await a.write("new.md", null)
  await a.engine.runCycle()
  expect(await a.engine.status()).toMatchObject({ kind: "synced" })
  await b.engine.runCycle()
  expect(await b.read("new.md")).toBeNull()
}, TIMEOUT)

test("a journaled op under a foreign peer that the doc lacks stays queued, is never imported or sent, and the cycle does not fail", async () => {
  const { a, b } = await pair()
  await a.write("x.md", note("mine\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  const { LoroDoc } = await loadLoroRuntime()
  const foreign = new LoroDoc()
  foreign.setPeerId("4242")
  foreign.getText("body").insert(0, "not this device's op")
  foreign.commit()
  const item = { key: "x.md", ops: toBase64(foreign.export({ mode: "update" })) }
  foreign.free()
  const versionBefore = await a.store.version("x.md")
  await a.engine.journal.setPending({ items: [item], outgoing: null })
  expect(await a.engine.runCycle()).toMatchObject({ held: ["x.md"] })
  expect(await a.store.version("x.md")).toBe(versionBefore)
  expect((await a.engine.journal.pending()).items).toEqual([item])
  expect(await a.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "oversized_item", stuck: ["x.md"] } })
  await b.engine.runCycle()
  expect(await b.read("x.md")).toBe(note("mine\n"))
}, TIMEOUT)
