import { afterEach, expect, spyOn, test } from "bun:test"
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import * as resilient from "../../fs/resilient"
import { CrashInjected } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import type { PendingItem, PendingOps } from "./outbox"

// #12286: a push must hold what one batch needs, not the whole backlog. Each batch used to re-read
// and re-write one journal file holding every pending item's ops plus the sealed batch, several
// times per batch, so the pushing device's peak memory grew with the size of the set.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const BATCH_BYTES = 16 * 1024
const ITEMS = 40
/** What the journal may keep per pending item besides its ops: a key, a digest and a size. */
const PER_ITEM_INDEX_BYTES = 256

// The fake store renders an item's lines in sorted order, so the line numbers are zero-padded.
const body = (n: number): string => Array.from({ length: 64 }, (_, line) => `item ${n} line ${String(line).padStart(2, "0")} ${"x".repeat(48)}\n`).join("")
const journalFile = (path: unknown): boolean => /[/\\]omo-sync[/\\]/.test(String(path))
const sizeOf = (data: unknown): number => (typeof data === "string" ? Buffer.byteLength(data) : data instanceof Uint8Array ? data.byteLength : 0)

test("pushing a backlog of many batches never reads or writes a journal file larger than one batch plus an index", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", (at) => {
    if (at === "persisted") throw new CrashInjected(at)
  }, { batchBytes: BATCH_BYTES })
  devices.push(a)
  const keys = Array.from({ length: ITEMS }, (_, n) => `notes/n-${String(n).padStart(2, "0")}.md`)
  for (const [n, key] of keys.entries()) await a.write(key, body(n))
  // The capture is journaled first; the cycle that resumes from it only pushes.
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await a.restart()

  const reads = spyOn(resilient, "readFile")
  const writes = spyOn(resilient, "writeFile")
  const sizes: { path: string; bytes: number }[] = []
  try {
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    for (const [i, call] of reads.mock.calls.entries()) {
      // A read of a file that is not there yet rejects (the caller falls back); it allocated nothing.
      const data: unknown = await Promise.resolve(reads.mock.results[i]?.value).catch(() => null)
      if (journalFile(call[0])) sizes.push({ path: String(call[0]), bytes: sizeOf(data) })
    }
    for (const call of writes.mock.calls) if (journalFile(call[0])) sizes.push({ path: String(call[0]), bytes: sizeOf(call[1]) })
  } finally {
    reads.mockRestore()
    writes.mockRestore()
  }

  // The set is many batches wide, so a file holding the whole backlog cannot pass the bound below.
  expect(server.entries.length).toBeGreaterThanOrEqual(10)
  const bound = 2 * BATCH_BYTES + PER_ITEM_INDEX_BYTES * ITEMS
  expect(sizes.length).toBeGreaterThan(0)
  expect(sizes.filter((s) => s.bytes > bound)).toEqual([])

  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  for (const [n, key] of keys.entries()) expect(await b.read(key)).toBe(body(n))
}, GIT_TEST_TIMEOUT)

// Storage migration contract: builds before #12286 kept every pending item's base64 ops and the
// sealed batch's bytes inline in pending.json. A device stopped mid-push on such a build must
// resume that batch under its own id (appended once) and still push the rest of its backlog.
test("a pending journal an older build wrote inline resumes its batch once and pushes the rest", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", (at) => {
    if (at === "uploaded") throw new CrashInjected(at)
  }, { batchBytes: 64 })
  devices.push(a)
  const keys = ["one.md", "two.md", "three.md"]
  for (const key of keys) await a.write(key, `${key} body\n`)
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)

  const syncDir = join(a.repo.gitDir, "omo-sync")
  const index: PendingOps = JSON.parse(await readFile(join(syncDir, "pending.json"), "utf8"))
  const outgoing = index.outgoing
  if (outgoing === null) throw new Error("the crash left no batch in flight")
  const inline = async (item: PendingItem) => ({ key: item.key, ops: Buffer.from(await a.engine.journal.outbox.readOps(item)).toString("base64") })
  const { items: carried, ...meta } = outgoing
  const legacy = {
    items: await Promise.all(index.items.map(inline)),
    outgoing: { ...meta, bytes: (await readFile(join(syncDir, "pending", `batch-${meta.batchId}.bin`))).toString("base64"), items: await Promise.all(carried.map(inline)) },
  }
  expect(legacy.items.length).toBeGreaterThan(carried.length)
  await rm(join(syncDir, "pending"), { recursive: true, force: true })
  await writeFile(join(syncDir, "pending.json"), `${JSON.stringify(legacy)}\n`)

  await a.restart()
  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  expect(server.entries.filter((e) => e.batchId === meta.batchId)).toHaveLength(1)
  expect(await a.engine.journal.pending()).toEqual({ items: [], outgoing: null })
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  for (const key of keys) expect(await b.read(key)).toBe(`${key} body\n`)
}, GIT_TEST_TIMEOUT)
