import { describe, expect, test, afterEach } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"

import { buildIdentityPaths, type MemoryIdentityPaths } from "../identity"
import type { TranscriptEntry } from "../journal"
import {
  FactsQueue,
  factsQueuePaths,
  type FactsEnqueueRequest,
  type FactsQueueEntry,
} from "./queue"

const IDENTITY = "facts-queue-agent"
const CONVERSATION = "conversation-alpha"
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function identityFixture(): Promise<MemoryIdentityPaths> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-queue-")))
  tempDirs.push(dir)
  return buildIdentityPaths(join(dir, "memory"), IDENTITY)
}

function entry(kind: "user" | "assistant", messageId: string, text: string): TranscriptEntry {
  return {
    kind,
    text,
    captured_at: "2026-01-01T00:00:00.000Z",
    source_line_id: `${messageId}:${kind}`,
    source_message_id: messageId,
  }
}

/** Canonical journal: user/assistant pairs m1..mN in positional order. */
function journal(count: number): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (let index = 1; index <= count; index += 1) {
    entries.push(entry("user", `m${index}`, `ask ${index}`))
    entries.push(entry("assistant", `m${index}`, `answer ${index}`))
  }
  return entries
}

function request(
  entries: readonly TranscriptEntry[],
  overrides: Partial<FactsEnqueueRequest> = {},
): FactsEnqueueRequest {
  return {
    identity: IDENTITY,
    sessionId: "session-1",
    conversationId: CONVERSATION,
    entries,
    ...overrides,
  }
}

function clockFrom(start: number): () => Date {
  let tick = start
  return () => new Date((tick += 1000))
}

async function queueFileNames(paths: MemoryIdentityPaths): Promise<string[]> {
  const names = await readdir(paths.factsQueue).catch(() => [] as string[])
  return names.filter((name) => name.endsWith(".json") && name !== "consumed.json").sort()
}

describe("facts queue enqueue", () => {
  test("#given a fresh journal delta #when enqueue runs #then one queue file holds the full canonical range", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    const entries = journal(2)

    // when
    const result = await queue.enqueue(request(entries))

    // then
    expect(result.enqueued).toBe(true)
    const names = await queueFileNames(paths)
    expect(names).toHaveLength(1)
    const pending = await queue.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.version).toBe(1)
    expect(pending[0]?.conversationId).toBe(CONVERSATION)
    expect(pending[0]?.range.start_message_id).toBe("m1")
    expect(pending[0]?.range.end_message_id).toBe("m2")
    expect(pending[0]?.range.end_snapshot_line).toBe(entries.length)
    expect(pending[0]?.entries.map((row) => row.source_message_id)).toEqual([
      "m1",
      "m1",
      "m2",
      "m2",
    ])
  })

  test("#given an identical settle #when enqueue runs again #then the duplicate endpoint is skipped", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    const entries = journal(2)
    await queue.enqueue(request(entries))

    // when
    const duplicate = await queue.enqueue(request(entries))

    // then
    expect(duplicate.enqueued).toBe(false)
    if (duplicate.enqueued) throw new Error("expected the duplicate settle to be skipped")
    expect(duplicate.reason).toBe("no-new-entries")
    expect(await queueFileNames(paths)).toHaveLength(1)
  })

  test("#given a retained entry ending at m2 #when a later settle arrives #then the new range starts strictly after it", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))

    // when
    const second = await queue.enqueue(request(journal(4)))

    // then
    expect(second.enqueued).toBe(true)
    const pending = await queue.listPending()
    expect(pending).toHaveLength(2)
    const ranges = pending.map((item) => [item.range.start_message_id, item.range.end_message_id])
    expect(ranges).toEqual([
      ["m1", "m2"],
      ["m3", "m4"],
    ])
  })

  test("#given the consumed watermark already covers the endpoint #when enqueue runs #then nothing is published", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    const entries = journal(2)
    await queue.enqueue(request(entries))
    const pending = await queue.listPending()
    await queue.markConsumed(pending)

    // when
    const again = await queue.enqueue(request(entries))

    // then
    expect(again.enqueued).toBe(false)
    expect(await queueFileNames(paths)).toHaveLength(0)
    expect(await queue.listPending()).toHaveLength(0)
  })

  test("#given only non-canonical trailing entries #when enqueue runs #then no queue file is published", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    const entries: TranscriptEntry[] = [
      {
        kind: "tool_call",
        name: "read",
        captured_at: "2026-01-01T00:00:00.000Z",
        source_line_id: "m1:tool:call-1",
        source_message_id: "m1",
      },
    ]

    // when
    const result = await queue.enqueue(request(entries))

    // then
    expect(result.enqueued).toBe(false)
    expect(await queueFileNames(paths)).toHaveLength(0)
  })
})
  test("#given an aborted drain signal #when enqueue is attempted #then nothing publishes and the cursor stays untouched", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    const aborted = new AbortController()
    aborted.abort()

    // when
    const result = await queue.enqueue(request(journal(2), { signal: aborted.signal }))

    // then
    expect(result.enqueued).toBe(false)
    expect(await queue.listPending()).toHaveLength(0)
    const cursor = await queue.readCursor(CONVERSATION)
    expect(cursor.enqueued_through_message_id).toBeNull()
    expect(cursor.consumed_through_message_id).toBeNull()
  })

  test("#given the abort fires at the interior clock hook #when enqueue runs #then nothing publishes and the cursor stays untouched", async () => {
    // given
    const paths = await identityFixture()
    const aborted = new AbortController()
    const queue = new FactsQueue({
      identityPaths: paths,
      now: () => {
        aborted.abort()
        return new Date("2026-01-15T12:00:00.000Z")
      },
    })

    // when
    const result = await queue.enqueue(request(journal(2), { signal: aborted.signal }))

    // then
    expect(result.enqueued).toBe(false)
    expect(await queue.listPending()).toHaveLength(0)
    const cursor = await queue.readCursor(CONVERSATION)
    expect(cursor.enqueued_through_message_id).toBeNull()
  })

  test("#given the abort fires after the publish lands #when the cursor advance is attempted #then the batch stays retryable with the watermark unmoved", async () => {
    // given
    const paths = await identityFixture()
    const aborted = new AbortController()
    const prototype = FactsQueue.prototype as unknown as Record<string, (entry: FactsQueueEntry, at: Date, signal?: AbortSignal) => Promise<void>>
    const original = prototype["publish"]
    prototype["publish"] = async (entry, at, signal) => {
      await original.call(queue, entry, at, signal)
      aborted.abort()
    }
    const queue = new FactsQueue({ identityPaths: paths, now: () => new Date("2026-01-15T12:00:00.000Z") })

    // when
    let result: Awaited<ReturnType<FactsQueue["enqueue"]>>
    try {
      result = await queue.enqueue(request(journal(2), { signal: aborted.signal }))
    } finally {
      prototype["publish"] = original
    }

    // then: the publish landed (one started atomic write), but the watermark never moved,
    // so a later launch sees the batch as pending and retries it.
    expect(result.enqueued).toBe(true)
    expect(await queue.listPending()).toHaveLength(1)
    const cursor = await queue.readCursor(CONVERSATION)
    expect(cursor.enqueued_through_message_id).toBeNull()
  })
