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

describe("facts queue reconcile", () => {
  test("#given a leftover queue file with no completion #when reconcile runs #then it is listed as launchable", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))

    // when: a fresh process (crash recovery) reads the durable queue
    const recovered = new FactsQueue({ identityPaths: paths, now: clockFrom(90_000) })
    const launchable = await recovered.listPending()

    // then
    expect(launchable).toHaveLength(1)
    expect(launchable[0]?.conversationId).toBe(CONVERSATION)
    expect(launchable[0]?.entries).toHaveLength(4)
  })

  test("#given a malformed queue file #when listPending runs #then it is ignored instead of throwing", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))
    await writeFile(join(paths.factsQueue, "20260101T000000000Z-deadbeefcafe-12345678.json"), "{ not json")

    // when
    const pending = await queue.listPending()

    // then
    expect(pending).toHaveLength(1)
  })

  test("#given consumed entries #when markConsumed runs #then the files are deleted and the watermark records the endpoint", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    await queue.enqueue(request(journal(2)))
    const pending = await queue.listPending()

    // when
    await queue.markConsumed(pending)

    // then
    expect(await queueFileNames(paths)).toHaveLength(0)
    const consumed: unknown = JSON.parse(
      await readFile(factsQueuePaths(paths).consumedPath, "utf8"),
    )
    expect(consumed).toMatchObject({
      version: 1,
      consumed: { [CONVERSATION]: { end_message_id: "m2" } },
    })
  })
})
