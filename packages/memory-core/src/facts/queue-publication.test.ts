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

describe("facts queue file naming", () => {
  test("#given a published entry #when the filename is inspected #then it is colon-free and hashes the conversation id", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })

    // when
    await queue.enqueue(request(journal(1)))

    // then
    const [name = ""] = await queueFileNames(paths)
    expect(name).not.toContain(":")
    expect(name).not.toContain(CONVERSATION)
    expect(name).toMatch(/^\d{8}T\d{6}\d{3}Z-[a-f0-9]{12}-[a-f0-9]{8}\.json$/)
  })

  test("#given two publications in the same millisecond #when both land #then the endpoint hash keeps them distinct", async () => {
    // given
    const paths = await identityFixture()
    const frozen = (): Date => new Date(0)
    const queue = new FactsQueue({ identityPaths: paths, now: frozen })

    // when
    await queue.enqueue(request(journal(1)))
    await queue.enqueue(request(journal(2)))

    // then
    expect(await queueFileNames(paths)).toHaveLength(2)
  })
})

describe("facts queue concurrency", () => {
  test("#given two concurrent enqueue attempts for the same delta #when both run #then exactly one entry is published", async () => {
    // given
    const paths = await identityFixture()
    const entries = journal(2)
    const first = new FactsQueue({ identityPaths: paths, now: clockFrom(0) })
    const second = new FactsQueue({ identityPaths: paths, now: clockFrom(50_000) })

    // when
    const results = await Promise.all([
      first.enqueue(request(entries)),
      second.enqueue(request(entries)),
    ])

    // then
    expect(results.filter((result) => result.enqueued)).toHaveLength(1)
    expect(await queueFileNames(paths)).toHaveLength(1)
  })
})
