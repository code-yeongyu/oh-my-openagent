// An oversized edit a pre-fix build already queued (#12284 review M1) must not be held forever: it
// never left the device, so it is wound back into the working file, and from there it follows the
// normal hold-until-it-fits path. The emulation below is exactly what that build left behind: the
// edit captured, imported and made the baseline, then journaled as pending and never sent.

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, expect, test } from "bun:test"

import { CrashInjected } from "./engine"
import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { toBase64, type WireItem } from "./journal"

const TIMEOUT = 60_000
const BOUND = 4096

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

// The fake store renders an item as its sorted distinct lines, so its texts are frontmatter-free and already sorted.
const texts = (realStore: boolean) => {
  const wrap = (body: string) => (realStore ? `---\ndescription: note\n---\n${body}` : body)
  return {
    synced: wrap("a synced once\n"),
    fits: wrap("a synced once\nb now it fits\n"),
    big: wrap(`a synced once\nm old build\n${"z".repeat(BOUND * 2)}\n`),
    bigger: wrap(`a synced once\nm old build\nn a later small edit\n${"z".repeat(BOUND * 2)}\n`),
  }
}

/** What the pre-fix capture did for one edit: journal, import, baseline, persist. */
async function oldBuildCapture(device: Device, key: string, text: string): Promise<WireItem> {
  await device.write(key, text)
  const ops = await device.store.capture(key, text)
  if (ops === null) throw new Error("emulation: the old build captured nothing")
  await device.store.apply(key, ops)
  await device.store.markMaterialized(key, text)
  await device.store.persist()
  const item = { key, ops: toBase64(ops) }
  const pending = await device.engine.journal.pending()
  await writeInlinePending(device, [...pending.items, item])
  return item
}

async function stuckDevice(realStore: boolean) {
  const t = texts(realStore)
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore, batchBytes: BOUND })
  const b = await makeDevice(server, "b", undefined, { realStore, batchBytes: BOUND })
  devices.push(a, b)
  await a.write("legacy.md", t.synced)
  await a.engine.runCycle()
  await b.engine.runCycle()
  await oldBuildCapture(a, "legacy.md", t.big)
  await oldBuildCapture(a, "legacy.md", t.bigger)
  return { a, b, t }
}

const pendingKeys = async (device: Device) => (await device.engine.journal.pending()).items.map((item) => item.key)

for (const realStore of [true, false]) {
  const store = realStore ? "Loro store" : "fake store"

  test(
    `an edit the old build queued syncs once the file fits, and the peer gets exactly that file (${store})`,
    async () => {
      const { a, b, t } = await stuckDevice(realStore)
      await a.write("legacy.md", t.fits)
      expect(await a.engine.runCycle()).toMatchObject({ pushed: true, held: [] })
      expect(await pendingKeys(a)).toEqual([])
      expect(await a.engine.status()).toMatchObject({ kind: "synced" })
      await b.engine.runCycle()
      expect(await b.read("legacy.md")).toBe(t.fits)
      expect(await a.read("legacy.md")).toBe(t.fits)
    },
    TIMEOUT,
  )

  test(
    `while the old build's file is still too large it is held from the file on disk, with nothing left queued (${store})`,
    async () => {
      const { a, b, t } = await stuckDevice(realStore)
      expect(await a.engine.runCycle()).toMatchObject({ held: ["legacy.md"] })
      expect(await pendingKeys(a)).toEqual([])
      expect(await a.read("legacy.md")).toBe(t.bigger)
      expect(await a.engine.status()).toMatchObject({
        kind: "failing",
        failure: { kind: "oversized_item", keys: ["legacy.md"] },
      })
      await b.engine.runCycle()
      expect(await b.read("legacy.md")).toBe(t.synced)
    },
    TIMEOUT,
  )
}

test(
  "a crash right after the old build's edit is wound back and before the journal drops it resumes to the same outcome",
  async () => {
    const { a, b, t } = await stuckDevice(true)
    await a.write("legacy.md", t.fits)
    await a.restart((at) => {
      if (at === "rewound") throw new CrashInjected(at)
    })
    await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await a.restart()
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true, held: [] })
    expect(await pendingKeys(a)).toEqual([])
    await b.engine.runCycle()
    expect(await b.read("legacy.md")).toBe(t.fits)
  },
  TIMEOUT,
)

test(
  "after the wind-back the device's next delete of that file reaches the peer, under the device's own peer",
  async () => {
    const { a, b } = await stuckDevice(true)
    await a.write("legacy.md", null)
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true, held: [] })
    await b.engine.runCycle()
    expect(await b.read("legacy.md")).toBeNull()
  },
  TIMEOUT,
)

test(
  "an op the old build journaled but never imported is dropped, and the file is captured afresh",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true, batchBytes: BOUND })
    const b = await makeDevice(server, "b", undefined, { realStore: true, batchBytes: BOUND })
    devices.push(a, b)
    const t = texts(true)
    await a.engine.runCycle()
    await a.write("legacy.md", t.big)
    const ops = await a.store.capture("legacy.md", t.big)
    if (ops === null) throw new Error("emulation: nothing captured")
    await writeInlinePending(a, [{ key: "legacy.md", ops: toBase64(ops) }])
    await a.write("legacy.md", t.fits)
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true, held: [] })
    expect(await pendingKeys(a)).toEqual([])
    await b.engine.runCycle()
    expect(await b.read("legacy.md")).toBe(t.fits)
  },
  TIMEOUT,
)

test(
  "a queued op this device cannot attribute to itself stays queued and is named as stuck, never wound back",
  async () => {
    const server = new FakeSyncServer()
    const lines: string[] = []
    const a = await makeDevice(server, "a", undefined, {
      realStore: true,
      batchBytes: BOUND,
      log: (line) => lines.push(line),
    })
    devices.push(a)
    await a.engine.runCycle()
    const foreign = { key: "foreign.md", ops: toBase64(new Uint8Array(BOUND * 2).fill(7)) }
    await writeInlinePending(a, [foreign])
    expect(await a.engine.runCycle()).toMatchObject({ held: ["foreign.md"] })
    await expectOnlyPending(a, foreign)
    expect(await a.engine.status()).toMatchObject({
      kind: "failing",
      failure: { kind: "oversized_item", keys: ["foreign.md"], stuck: ["foreign.md"] },
    })
    expect(lines.filter((line) => line.startsWith("sync.item.stuck"))).toEqual([
      `sync.item.stuck len=${Buffer.byteLength("foreign.md")} ops=1`,
    ])
  },
  TIMEOUT,
)
