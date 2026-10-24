import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test"
import { chmod, mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import * as resilient from "../fs/resilient"
import { buildIdentityPaths } from "../identity"
import type { TranscriptEntry } from "../journal"
import { removeTree } from "../../../../test-support/remove-tree"
import { FactsQueue } from "./queue"
import { FactsFailureStore } from "./failures-store"
import { renderFailuresFile, type FactsFailureRecord } from "./failures-schema"
import { selectLaunchable } from "./failures-selection"
import { factsQueuePaths, type FactsQueueEntry } from "./schema"

// Entry reads are counted at the fs boundary with a spy installed per test and restored after it;
// a module mock would replace ../fs/resilient for every test file sharing the process.
let readSpy: Mock<typeof resilient.readFile> | undefined
beforeEach(() => {
  readSpy = spyOn(resilient, "readFile")
})
function entryReads(): string[] {
  return (readSpy?.mock.calls ?? []).map((call) => String(call[0])).filter((path) => /-[a-f0-9]{12}-[a-f0-9]{8}\.json$/.test(path))
}

const roots: string[] = []
const NOW = new Date("2026-10-23T00:00:00.000Z")
afterEach(async () => {
  readSpy?.mockRestore()
  readSpy = undefined
  await Promise.all(roots.splice(0).map((root) => removeTree(root)))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "facts-parked-"))
  roots.push(root)
  const paths = buildIdentityPaths(join(root, "memory"), "agent")
  const layout = factsQueuePaths(paths)
  await mkdir(layout.queueDir, { recursive: true })
  return { paths, layout, queue: new FactsQueue({ identityPaths: paths, now: () => NOW }) }
}

function message(id: string): TranscriptEntry {
  return { kind: "user", text: id, source_message_id: id, source_line_id: id, captured_at: NOW.toISOString() }
}

function queued(conversationId: string, end = "m1"): FactsQueueEntry {
  return {
    version: 1, identity: "agent", sessionId: conversationId, conversationId,
    enqueuedAt: NOW.toISOString(),
    range: { start_message_id: end, end_message_id: end, start_line: 0, end_snapshot_line: 1 },
    entries: [message(end)],
  }
}

function parked(conversationId: string, end = "m1"): FactsFailureRecord {
  return {
    conversationId, end_message_id: end, end_snapshot_line: 1, state: "parked", streak: 1,
    firstFailureAt: NOW.toISOString(), lastFailureAt: NOW.toISOString(), parkedAt: NOW.toISOString(),
    lastReason: "payload_entry_oversize", lastFailureId: "legacy", nextEligibleAt: null,
  }
}

// Writing 10,000 fixture files alone takes 7-9 s on a loaded host (measured with and without the change under test),
// so this scale test owns an explicit bound instead of racing bun's 10 s default.
test("#given 10000 parked-but-hot files and one live file #when enqueue and launch selection claim run #then only live files are read", async () => {
  const { paths, layout, queue } = await fixture()
  const records = Array.from({ length: 10_000 }, (_, index) => parked(`parked-${index}`))
  for (let start = 0; start < records.length; start += 100) {
    await Promise.all(records.slice(start, start + 100).map((record) =>
      writeFile(layout.entryPath(record.conversationId, "m1", NOW), JSON.stringify(queued(record.conversationId))),
    ))
  }
  await writeFile(layout.failuresPath, renderFailuresFile(records, NOW.toISOString()))
  await writeFile(layout.entryPath("live", "m1", NOW), JSON.stringify(queued("live")))

  readSpy?.mockClear()
  await queue.enqueue({ identity: "agent", sessionId: "live", conversationId: "live", entries: [message("m1"), message("m2")] })
  const pending = await queue.listPending()
  const failures = await new FactsFailureStore({ identityPaths: paths }).readFailures()
  const selected = selectLaunchable(pending, failures, NOW).selected
  const claimed = await queue.claim(selected, "settle")
  const reads = entryReads().length
  console.log(`facts backlog: parked=10000 entryReads=${reads} bound=5 claimed=${claimed.length}`)
  expect(reads).toBeGreaterThan(0)
  expect(reads).toBeLessThanOrEqual(5)
  expect(claimed.map((entry) => entry.range.end_message_id).sort()).toEqual(["m1", "m2"])
  expect(await readdir(join(layout.queueDir, "parked"))).toHaveLength(10_000)
}, 60_000)

test("#given parked hot files beside backoff and live entries #when locked operations migrate twice #then exactly the parked files move without loss", async () => {
  const { paths, layout, queue } = await fixture()
  const old = queued("old")
  const oldPath = layout.entryPath("old", "m1", NOW)
  const secondPath = layout.entryPath("old", "m1", new Date(NOW.getTime() + 1))
  const livePath = layout.entryPath("live", "m1", NOW)
  const backoffPath = layout.entryPath("backoff", "m1", NOW)
  const cold = join(layout.queueDir, "parked")
  await mkdir(cold)
  const alreadyPath = join(cold, basename(layout.entryPath("already", "m1", NOW)))
  for (const [path, value] of [[oldPath, old], [secondPath, old], [livePath, queued("live")],
    [backoffPath, queued("backoff")], [alreadyPath, queued("already")]] as const) {
    await writeFile(path, JSON.stringify(value))
  }
  const backoff: FactsFailureRecord = {
    ...parked("backoff"), state: "backoff", nextEligibleAt: new Date(NOW.getTime() + 60_000).toISOString(),
    parkedAt: undefined,
  }
  await writeFile(layout.failuresPath, renderFailuresFile([parked("old"), parked("already"), parked("missing"), backoff], NOW.toISOString()))
  const bytesBefore = await Promise.all([oldPath, secondPath, livePath, backoffPath, alreadyPath].map((path) => readFile(path, "utf8")))

  expect((await queue.listPending()).map((entry) => entry.conversationId).sort()).toEqual(["backoff", "live"])
  const movedNames = (await readdir(cold)).sort()
  expect(movedNames).toEqual([basename(oldPath), basename(secondPath), basename(alreadyPath)].sort())
  const bytesAfter = await Promise.all([join(cold, basename(oldPath)), join(cold, basename(secondPath)), livePath, backoffPath, alreadyPath]
    .map((path) => readFile(path, "utf8")))
  expect(bytesAfter).toEqual(bytesBefore)
  const hotNames = (await readdir(layout.queueDir)).filter((name) => /-[a-f0-9]{8}\.json$/.test(name))
  expect(hotNames.length + movedNames.length).toBe(5)

  await new FactsQueue({ identityPaths: paths }).listPending()
  expect((await readdir(cold)).sort()).toEqual(movedNames)
  expect((await readdir(layout.queueDir)).filter((name) => /-[a-f0-9]{8}\.json$/.test(name)).sort()).toEqual(hotNames.sort())
})

test("#given a parked enqueue range #when its conversation grows #then the enqueue watermark prevents covering that range again", async () => {
  const { paths, layout, queue } = await fixture()
  const request = { identity: "agent", sessionId: "same", conversationId: "same", entries: [message("m1")] }
  const first = await queue.enqueue(request)
  expect(first.enqueued).toBe(true)
  await new FactsFailureStore({ identityPaths: paths, now: () => NOW }).recordFailure({
    targets: [{ conversationId: "same", endMessageId: "m1", endSnapshotLine: 1 }],
    reason: "payload_entry_oversize", failureId: "park",
  })
  expect(await queue.listPending()).toEqual([])
  expect(await readdir(layout.parkedDir)).toHaveLength(1)
  expect((await queue.enqueue(request)).enqueued).toBe(false)
  const next = await queue.enqueue({ ...request, entries: [...request.entries, message("m2")] })
  expect(next.enqueued).toBe(true)
  if (!next.enqueued) throw new Error("expected a new tail")
  expect(next.entry.range).toMatchObject({ start_line: 1, start_message_id: "m2", end_message_id: "m2" })
  expect((await queue.readCursor("same")).enqueued_through_message_id).toBe("m2")
})

test("#given an entry published before its cursor advanced and then parked #when its conversation grows #then the new range starts after the parked one", async () => {
  // The crash window enqueue documents: the queue file landed, the cursor write did not. Parking moves the only
  // record of that endpoint into parked/, so the anchor must still read it there or m1 is extracted twice.
  const { layout, queue } = await fixture()
  await writeFile(layout.entryPath("same", "m1", NOW), JSON.stringify(queued("same")))
  await writeFile(layout.failuresPath, renderFailuresFile([parked("same")], NOW.toISOString()))
  expect(await queue.listPending()).toEqual([])
  expect((await queue.readCursor("same")).enqueued_through_message_id).toBeNull()

  const next = await queue.enqueue({
    identity: "agent", sessionId: "same", conversationId: "same", entries: [message("m1"), message("m2")],
  })

  expect(next.enqueued).toBe(true)
  if (!next.enqueued) throw new Error("expected a new tail")
  expect(next.entry.range).toMatchObject({ start_line: 1, start_message_id: "m2", end_message_id: "m2" })
})

// chmod 000 does not deny reads on Windows or to root, so the permission-denied path is POSIX non-root only.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("#given parked/ cannot be listed #when the anchor needs it #then enqueue fails instead of moving the anchor backward", async () => {
  const { layout, queue } = await fixture()
  await writeFile(layout.entryPath("same", "m1", NOW), JSON.stringify(queued("same")))
  await writeFile(layout.failuresPath, renderFailuresFile([parked("same")], NOW.toISOString()))
  expect(await queue.listPending()).toEqual([])
  await chmod(layout.parkedDir, 0o000)
  try {
    const attempt = queue.enqueue({
      identity: "agent", sessionId: "same", conversationId: "same", entries: [message("m1"), message("m2")],
    })
    await expect(attempt).rejects.toThrow()
  } finally {
    await chmod(layout.parkedDir, 0o700)
  }
})

test("#given retained files for many healthy conversations #when enqueue and a selected claim run #then unrelated payloads are never read", async () => {
  const { layout, queue } = await fixture()
  for (let index = 0; index < 40; index += 1) {
    const conversation = `other-${index}`
    await writeFile(layout.entryPath(conversation, "m1", NOW), JSON.stringify(queued(conversation)))
  }
  await writeFile(layout.entryPath("same", "m1", NOW), JSON.stringify(queued("same")))
  readSpy?.mockClear()
  const next = await queue.enqueue({
    identity: "agent", sessionId: "same", conversationId: "same", entries: [message("m1"), message("m2")],
  })
  expect(next.enqueued).toBe(true)
  expect(entryReads()).toEqual([layout.entryPath("same", "m1", NOW)])
  const pending = (await queue.listPending()).filter((entry) => entry.conversationId === "same")
  readSpy?.mockClear()
  const first = await queue.claim([...pending, ...pending], "first")
  expect(first).toHaveLength(2)
  expect(entryReads()).toHaveLength(2)
  expect(await queue.claim(pending, "second")).toEqual([])
  await queue.releaseClaim(first, "first")
  const older = first.find((entry) => entry.range.end_message_id === "m1")
  if (older === undefined) throw new Error("expected the older claim")
  await queue.markConsumed([older])
  expect((await queue.claim(pending, "third")).map((entry) => entry.range.end_message_id)).toEqual(["m2"])
})

test.each(["payload_entry_oversize", "secret_like_content", "child_exit"] as const)(
  "#given %s reaches an absorbing park #when the ledger is written #then bytes move to parked and manual retry restores them",
  async (reason) => {
    const { paths, layout, queue } = await fixture()
    await queue.enqueue({ identity: "agent", sessionId: "same", conversationId: "same", entries: [message("m1")] })
    const path = layout.entryPath("same", "m1", NOW)
    const before = await readFile(path, "utf8")
    const store = new FactsFailureStore({ identityPaths: paths, now: () => NOW })
    for (let index = 0; index < (reason === "child_exit" ? 5 : 1); index += 1) {
      await store.recordFailure({
        targets: [{ conversationId: "same", endMessageId: "m1", endSnapshotLine: 1 }],
        failureId: `failure-${index}`, reason,
      })
    }
    expect(await queue.listPending()).toEqual([])
    expect(await readFile(join(layout.parkedDir, basename(path)), "utf8")).toBe(before)
    // A later reason and an idempotent replay cannot resurrect an absorbing park.
    await store.recordFailure({
      targets: [{ conversationId: "same", endMessageId: "m1", endSnapshotLine: 1 }],
      failureId: "later", reason: "other",
    })
    expect((await store.readFailures()).entries[0]?.state).toBe("parked")
    expect(await store.clearForRetry({ conversationId: "same" })).toBe(1)
    expect(await readFile(path, "utf8")).toBe(before)
    expect(await readdir(layout.parkedDir)).toEqual([])
    expect(await queue.claim(await queue.listPending(), "retry")).toHaveLength(1)
  },
)
