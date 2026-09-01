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

describe("facts queue watermark monotonicity", () => {
  test("#given an older batch settling after a newer one was queued #when it is consumed #then the enqueue watermark never rolls back", async () => {
    // given: batch A (through m2) is queued, then batch B (through m4) is queued
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))
    await queue.enqueue(request(journal(4)))
    const pending = await queue.listPending()
    const olderBatch = pending.filter((item) => item.range.end_message_id === "m2")
    const newerBatch = pending.filter((item) => item.range.end_message_id === "m4")
    expect(olderBatch).toHaveLength(1)
    expect(newerBatch).toHaveLength(1)

    // when: the NEWER batch finishes first, then the OLDER batch finishes late
    await queue.markConsumed(newerBatch)
    const afterNewer = await queue.readCursor(CONVERSATION)
    await queue.markConsumed(olderBatch)
    const afterOlder = await queue.readCursor(CONVERSATION)

    // then: the enqueue watermark stays at the greatest durably queued endpoint
    expect(afterNewer.enqueued_through_message_id).toBe("m4")
    expect(afterOlder.enqueued_through_message_id).toBe("m4")
    // and the late older batch never drags the consumed watermark backward either
    expect(afterNewer.consumed_through_message_id).toBe("m4")
    expect(afterOlder.consumed_through_message_id).toBe("m4")
  })

  test("#given a late older batch consumed #when the next settle runs #then no range overlapping the retained newer entry is republished", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))
    await queue.enqueue(request(journal(4)))
    const pending = await queue.listPending()
    await queue.markConsumed(pending.filter((item) => item.range.end_message_id === "m4"))
    await queue.markConsumed(pending.filter((item) => item.range.end_message_id === "m2"))

    // when
    const next = await queue.enqueue(request(journal(6)))

    // then
    expect(next.enqueued).toBe(true)
    const republished = (await queue.listPending()).map((item) => [
      item.range.start_message_id,
      item.range.end_message_id,
    ])
    expect(republished).toEqual([["m5", "m6"]])
  })

  test("#given a failed batch #when it is retained #then the enqueue watermark does not roll back and the entry survives", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))
    const before = await queue.readCursor(CONVERSATION)

    // when: the extractor fails, so nothing is marked consumed
    const after = await queue.readCursor(CONVERSATION)

    // then
    expect(before.enqueued_through_message_id).toBe("m2")
    expect(after.enqueued_through_message_id).toBe("m2")
    expect(after.consumed_through_message_id).toBe(null)
    expect(await queue.listPending()).toHaveLength(1)
  })

  test("#given a queue file that landed without its cursor write #when the next settle runs #then the retained endpoint anchors the range", async () => {
    // given: simulate the crash window by deleting the cursor file only
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))
    await rm(factsQueuePaths(paths).cursorPath(CONVERSATION), { force: true })

    // when
    const next = await queue.enqueue(request(journal(4)))

    // then
    expect(next.enqueued).toBe(true)
    const ranges = (await queue.listPending()).map((item) => [
      item.range.start_message_id,
      item.range.end_message_id,
    ])
    expect(ranges).toEqual([
      ["m1", "m2"],
      ["m3", "m4"],
    ])
  })
})
