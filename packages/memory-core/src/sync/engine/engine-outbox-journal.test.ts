import { afterEach, expect, spyOn, test } from "bun:test"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"

import * as resilient from "../../fs/resilient"
import { CrashInjected, type EngineFault } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import type { OutgoingBatch, PendingItem, PendingOps } from "./outbox"
import type { FreezeOutcome } from "./ports"

// Storage contract of the outbox journal (#12286): pending.json is an index whose items' ops live
// in segment files and whose in-flight batch's bytes live in a batch file. Builds before #12286
// kept the ops and the bytes inline, and an older build running against a converted journal
// appends its own captures inline next to the index entries. Every such journal must still read,
// and every item in it must reach the server exactly once.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const crashAt =
  (point: string): EngineFault =>
  (at) => {
    if (at === point) throw new CrashInjected(point)
  }

const syncDir = (device: Device): string => join(device.repo.gitDir, "omo-sync")
const readIndex = async (device: Device): Promise<PendingOps> =>
  JSON.parse(await readFile(join(syncDir(device), "pending.json"), "utf8"))
const pendingFiles = (device: Device): Promise<string[]> => readdir(join(syncDir(device), "pending")).catch(() => [])
const inline = async (device: Device, item: PendingItem) => ({
  key: item.key,
  ops: Buffer.from(await device.engine.journal.outbox.readOps(item)).toString("base64"),
})

async function withFiles(
  server: FakeSyncServer,
  keys: readonly string[],
  fault: EngineFault,
  batchBytes?: number,
): Promise<Device> {
  const a = await makeDevice(server, "a", fault, batchBytes === undefined ? {} : { batchBytes })
  devices.push(a)
  for (const key of keys) await a.write(key, `${key} body\n`)
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  return a
}

/** Rewrites the journal the way a build before #12286 kept it: ops and the batch's bytes inline. */
async function rewriteInline(a: Device): Promise<OutgoingBatch> {
  const index = await readIndex(a)
  const outgoing = index.outgoing
  if (outgoing === null) throw new Error("the crash left no batch in flight")
  const { items: carried, ...meta } = outgoing
  const legacy = {
    items: await Promise.all(index.items.map((item) => inline(a, item))),
    outgoing: {
      ...meta,
      bytes: (await readFile(join(syncDir(a), "pending", `batch-${meta.batchId}.bin`))).toString("base64"),
      items: await Promise.all(carried.map((item) => inline(a, item))),
    },
  }
  expect(legacy.items.length).toBeGreaterThan(carried.length)
  await rm(join(syncDir(a), "pending"), { recursive: true, force: true })
  await writeFile(join(syncDir(a), "pending.json"), `${JSON.stringify(legacy)}\n`)
  return outgoing
}

async function receivesAll(server: FakeSyncServer, keys: readonly string[]): Promise<void> {
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  for (const key of keys) expect(await b.read(key)).toBe(`${key} body\n`)
}

test(
  "a pending journal an older build wrote inline resumes its batch once and pushes the rest",
  async () => {
    const server = new FakeSyncServer()
    const keys = ["one.md", "two.md", "three.md"]
    const a = await withFiles(server, keys, crashAt("uploaded"), 64)
    const sent = await rewriteInline(a)

    await a.restart()
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    expect(server.entries.filter((e) => e.batchId === sent.batchId)).toHaveLength(1)
    expect(await a.engine.journal.pending()).toEqual({ items: [], outgoing: null })
    await receivesAll(server, keys)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a journal mixing index entries with inline items an older build appended converts per entry and pushes every item once",
  async () => {
    const server = new FakeSyncServer()
    const keys = ["one.md", "two.md", "three.md", "four.md"]
    const a = await withFiles(server, keys, crashAt("persisted"))
    const index = await readIndex(a)
    const [one, two, three, four] = index.items
    if (one === undefined || two === undefined || three === undefined || four === undefined)
      throw new Error("expected four pending items")
    // An older build reads the index entries as items, writes them back untouched, and appends its own
    // captures inline; one of those repeats an item the index already holds.
    const mixed = {
      items: [one, two, await inline(a, three), await inline(a, four), await inline(a, one)],
      outgoing: null,
    }
    await writeFile(join(syncDir(a), "pending.json"), `${JSON.stringify(mixed)}\n`)

    await a.restart()
    const converted = await a.engine.journal.pending()
    // Every item once, in the order the journal held them: the inline copy of `one` collapses into its entry.
    expect(converted.items.map((i) => i.digest)).toEqual(index.items.map((i) => i.digest))
    expect(await readIndex(a)).toEqual(converted)
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    expect(await a.engine.journal.pending()).toEqual({ items: [], outgoing: null })
    expect(await pendingFiles(a)).toEqual([])
    await receivesAll(server, keys)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a conversion cut short before the index is rewritten keeps the old journal; the next read converts it once",
  async () => {
    const server = new FakeSyncServer()
    const keys = ["one.md", "two.md", "three.md"]
    const a = await withFiles(server, keys, crashAt("uploaded"), 64)
    const sent = await rewriteInline(a)
    await a.restart()

    const realRename = resilient.rename
    const rename = spyOn(resilient, "rename").mockImplementation((from, to, admit) =>
      String(to).endsWith(`${sep}pending.json`)
        ? Promise.reject(new CrashInjected("index-rename"))
        : realRename(from, to, admit),
    )
    try {
      await expect(a.engine.journal.pending()).rejects.toBeInstanceOf(CrashInjected)
    } finally {
      rename.mockRestore()
    }
    // The capture segment and the batch file were written; the inline index is still the journal.
    const leftovers = await pendingFiles(a)
    expect(leftovers.filter((name) => name.startsWith("seg-"))).toHaveLength(1)
    expect(leftovers).toContain(`batch-${sent.batchId}.bin`)
    expect((await readIndex(a)).items.every((item) => "ops" in item)).toBe(true)

    const converted = await a.engine.journal.pending()
    expect(converted.items.every((item) => !("ops" in item))).toBe(true)
    // A second read finds an index and converts nothing again.
    expect(await a.engine.journal.pending()).toEqual(converted)
    expect((await pendingFiles(a)).filter((name) => name.startsWith("seg-"))).toHaveLength(2)

    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    expect(server.entries.filter((e) => e.batchId === sent.batchId)).toHaveLength(1)
    expect(await pendingFiles(a)).toEqual([])
    await receivesAll(server, keys)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a frozen account refuses every append; no refused cycle leaves its sealed batch behind, and the backlog pushes once it thaws",
  async () => {
    const server = new FakeSyncServer()
    let outcome: FreezeOutcome = { kind: "frozen", reason: "unverified" }
    const a = await makeDevice(server, "a", undefined, { batchBytes: 64, freeze: { settle: async () => outcome } })
    devices.push(a)
    const keys = ["one.md", "two.md", "three.md"]
    for (const key of keys) await a.write(key, `${key} body\n`)
    server.frozen = true
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      expect(await a.engine.runCycle()).toMatchObject({ pushed: false })
      expect(server.appends.filter((append) => !append.ok)).toHaveLength(cycle)
      // The refused batch left the index, so its bytes left the disk: only the named segments stay.
      const index = await readIndex(a)
      expect(index.outgoing).toBeNull()
      expect((await pendingFiles(a)).sort()).toEqual([...new Set(index.items.map((item) => item.segment))].sort())
    }

    server.frozen = false
    outcome = { kind: "clear" }
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    expect(await pendingFiles(a)).toEqual([])
    await receivesAll(server, keys)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a sealed batch whose bytes no longer match their digest fails locally, before anything is uploaded",
  async () => {
    const server = new FakeSyncServer()
    const a = await withFiles(server, ["one.md", "two.md"], crashAt("sealed"))
    const outgoing = (await readIndex(a)).outgoing
    if (outgoing === null) throw new Error("the crash left no batch in flight")
    const path = join(syncDir(a), "pending", `batch-${outgoing.batchId}.bin`)
    const bytes = await readFile(path)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff
    await writeFile(path, bytes)

    await a.restart()
    await expect(a.engine.runCycle()).rejects.toThrow(
      `the sealed bytes of batch ${outgoing.batchId} do not match their digest`,
    )
    expect(server.entries).toHaveLength(0)
  },
  GIT_TEST_TIMEOUT,
)
