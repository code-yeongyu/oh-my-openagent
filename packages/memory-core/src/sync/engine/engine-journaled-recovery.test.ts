// A crash between journaling a capture and importing it (#12284 review, gate rounds 2-3) leaves the
// device exactly where a crash after importing would: the journaled op is in the doc and the baseline
// is the captured text, so a later revert or delete still reaches the peer. A journaled op this device
// cannot import is left alone, never sent, and never fails the cycle.

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, expect, spyOn, test } from "bun:test"

import { loadLoroRuntime } from "../../crdt/loro-runtime"
import { CrashInjected } from "./engine"
import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { toBase64, type WireItem } from "./journal"

const TIMEOUT = 60_000

/** Writes pending.json the way an older build did: inline base64 ops, which the outbox converts on read (#12286). */
const writeInlinePending = (device: Device, items: readonly unknown[]): Promise<void> =>
  writeFile(join(device.repo.gitDir, "omo-sync", "pending.json"), `${JSON.stringify({ items, outgoing: null })}\n`)

/** The pending journal holds exactly this one op, unchanged. */
async function expectOnlyPending(device: Device, item: WireItem): Promise<void> {
  const [kept, ...rest] = (await device.engine.journal.pending()).items
  expect(rest).toEqual([])
  expect(kept?.key).toBe(item.key)
  if (kept !== undefined) expect(toBase64(await device.engine.journal.outbox.readOps(kept))).toBe(item.ops)
}

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

test(
  "a revert to the exact pre-edit text after a crash between journaling and importing the edit reaches the peer",
  async () => {
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
  },
  TIMEOUT,
)

test(
  "deleting a new file whose creation crashed between journaling and importing reaches the peer as a delete",
  async () => {
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
  },
  TIMEOUT,
)

test(
  "a journaled op under a foreign peer that the doc lacks stays queued, is never imported or sent, and the cycle does not fail",
  async () => {
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
    await writeInlinePending(a, [item])
    expect(await a.engine.runCycle()).toMatchObject({ held: ["x.md"] })
    expect(await a.store.version("x.md")).toBe(versionBefore)
    await expectOnlyPending(a, item)
    expect(await a.engine.status()).toMatchObject({
      kind: "failing",
      failure: { kind: "oversized_item", stuck: ["x.md"] },
    })
    await b.engine.runCycle()
    expect(await b.read("x.md")).toBe(note("mine\n"))
  },
  TIMEOUT,
)

test(
  "a journaled op under this device's peer whose earlier ops the doc lacks is refused unimported, never sent, and named stuck",
  async () => {
    const { a, b } = await pair()
    await a.engine.runCycle()
    await b.engine.runCycle()
    const { LoroDoc } = await loadLoroRuntime()
    const source = new LoroDoc()
    source.setPeerId(a.store.peer() as `${number}`)
    source.getText("body").insert(0, "earlier ")
    source.commit()
    const mid = source.oplogVersion()
    source.getText("body").insert(8, "later")
    source.commit()
    const item = { key: "dep.md", ops: toBase64(source.export({ mode: "update", from: mid })) }
    source.free()
    const versionBefore = await a.store.version("dep.md")
    await writeInlinePending(a, [item])
    expect(await a.engine.runCycle()).toMatchObject({ held: ["dep.md"] })
    expect(await a.store.version("dep.md")).toBe(versionBefore)
    await expectOnlyPending(a, item)
    expect(await a.engine.status()).toMatchObject({
      kind: "failing",
      failure: { kind: "oversized_item", stuck: ["dep.md"] },
    })
    await b.engine.runCycle()
    expect(await b.read("dep.md")).toBeNull()
  },
  TIMEOUT,
)

test(
  "deleting a re-created file whose revival crashed between journaling and importing reaches the peer as a delete",
  async () => {
    const { a, b } = await pair()
    await a.write("r.md", note("same text\n"))
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("r.md", null)
    await a.engine.runCycle()
    await b.engine.runCycle()
    expect(await b.read("r.md")).toBeNull()
    await a.write("r.md", note("same text\n"))
    await a.restart(crashAtCaptured)
    await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await a.restart()
    await a.write("r.md", null)
    await a.engine.runCycle()
    expect(await a.engine.status()).toMatchObject({ kind: "synced" })
    await b.engine.runCycle()
    expect(await b.read("r.md")).toBeNull()
    expect(await a.read("r.md")).toBeNull()
  },
  TIMEOUT,
)

test(
  "a revive of a held file a peer deleted, crashed between journaling and importing, then edited again, ends identical on both devices",
  async () => {
    const bound = 4096
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true, batchBytes: bound })
    const b = await makeDevice(server, "b", undefined, { realStore: true, batchBytes: bound })
    devices.push(a, b)
    await a.write("shared.md", note("first\n"))
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("shared.md", note(`first\n${"y".repeat(bound * 2)}\n`))
    await a.engine.runCycle()
    await b.write("shared.md", null)
    await b.engine.runCycle()
    expect(await a.engine.runCycle()).toMatchObject({ held: ["shared.md"] })
    await a.write("shared.md", note("first\nfrom a\n"))
    await a.restart(crashAtCaptured)
    await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await a.restart()
    await a.write("shared.md", note("first\nfrom a\nmore\n"))
    await a.engine.runCycle()
    await b.engine.runCycle()
    expect(await a.read("shared.md")).toBe(note("first\nfrom a\nmore\n"))
    expect(await b.read("shared.md")).toBe(note("first\nfrom a\nmore\n"))
    expect(await a.engine.status()).toMatchObject({ kind: "synced" })
  },
  TIMEOUT,
)

/** A device whose next capture crashes once after the doc is persisted: its op stays pending, marked imported. */
async function crashedAfterPersist(name: string) {
  let armed = true
  const crash = (at: string) => {
    if (armed && at === "persisted") {
      armed = false
      throw new CrashInjected(at)
    }
  }
  const device = await makeDevice(new FakeSyncServer(), name, crash, { realStore: true })
  devices.push(device)
  await device.write("kept.md", note("kept\n"))
  await expect(device.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  const [entry, ...rest] = (await device.engine.journal.pending()).items
  expect(rest).toEqual([])
  expect(entry).toMatchObject({ key: "kept.md", imported: true })
  if (entry === undefined) throw new Error("no pending entry")
  return { device, entry }
}

test(
  "capture recovery never re-reads an op the doc already holds",
  async () => {
    const { device } = await crashedAfterPersist("a")
    const adopt = spyOn(device.store, "adoptJournaled")
    expect(await device.engine.runCycle()).toMatchObject({ pushed: true })
    expect(adopt).not.toHaveBeenCalled()
  },
  TIMEOUT,
)

test(
  "an entry whose imported mark was lost is checked once against the doc, never imported twice",
  async () => {
    // A crash between persisting the doc and writing the mark, or an older build dropping the field.
    const { device, entry } = await crashedAfterPersist("b")
    const { imported: _lost, ...unmarked } = entry
    await device.engine.journal.setPending({ items: [unmarked], outgoing: null })
    const adopt = spyOn(device.store, "adoptJournaled")
    const versionBefore = await device.store.version("kept.md")
    expect(await device.engine.runCycle()).toMatchObject({ pushed: true })
    expect(adopt).toHaveBeenCalledTimes(1)
    expect(await adopt.mock.results[0]?.value).toBe("held")
    expect(await device.store.version("kept.md")).toBe(versionBefore)
  },
  TIMEOUT,
)

test(
  "an entry whose capture never reached disk is marked imported only once the doc holding it is persisted",
  async () => {
    // Review of #12597 at 4647e55a6e: the store's persist fails after a capture applied the op in memory,
    // the next cycle finds the op "held" by that in-memory doc, and a restart before any later persist
    // must still re-import it rather than skip it as already imported.
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(a, b)
    await a.write("kept.md", note("one\ntwo\nthree\n"))
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("kept.md", note("ONE\ntwo\nthree\n"))
    const persist = spyOn(a.store, "persist").mockImplementationOnce(() => Promise.reject(new Error("ENOSPC")))
    await expect(a.engine.runCycle()).rejects.toThrow()
    persist.mockRestore()
    server.beforeNextAppend = () => Promise.reject(new Error("offline"))
    await expect(a.engine.runCycle()).rejects.toThrow()
    await a.restart()
    await a.write("kept.md", note("ONE\ntwo\nTHREE\n"))
    await a.engine.runCycle()
    await b.engine.runCycle()
    expect(await b.read("kept.md")).toBe(note("ONE\ntwo\nTHREE\n"))
    expect(await a.read("kept.md")).toBe(note("ONE\ntwo\nTHREE\n"))
  },
  TIMEOUT,
)
