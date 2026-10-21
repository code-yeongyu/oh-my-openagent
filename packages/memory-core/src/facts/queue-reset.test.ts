import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentityPaths } from "../identity"
import type { TranscriptEntry } from "../journal"
import { FactsQueue, factsQueuePaths } from "./queue"
import { removeTree } from "../../../../test-support/remove-tree"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function identityFixture(): Promise<MemoryIdentityPaths> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-reset-")))
  tempDirs.push(dir)
  return buildIdentityPaths(join(dir, "memory"), "facts-reset-agent")
}

function entry(kind: "user" | "assistant", messageId: string): TranscriptEntry {
  return { kind, text: messageId, captured_at: "2026-01-01T00:00:00.000Z", source_line_id: `${messageId}:${kind}`, source_message_id: messageId }
}

const request = (entries: readonly TranscriptEntry[]) => ({ identity: "facts-reset-agent", sessionId: "s", conversationId: "conv", entries })

describe("facts queue conversation reset", () => {
  test("#given a pending batch #when reset #then it refuses and keeps the watermark", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths })
    await queue.enqueue(request([entry("user", "u1"), entry("assistant", "a1")]))

    // when
    const reset = await queue.resetConversation("conv")

    // then
    expect(reset).toBe(false)
    expect((await queue.readCursor("conv")).enqueued_through_snapshot_line).toBe(2)
  })

  test("#given a consumed conversation #when reset and the retired journal restarts at line 0 #then new batches enqueue and consume", async () => {
    // given
    const paths = await identityFixture()
    const queue = new FactsQueue({ identityPaths: paths })
    const first = await queue.enqueue(request([entry("user", "u1"), entry("assistant", "a1"), entry("user", "u2"), entry("assistant", "a2")]))
    if (!first.enqueued) throw new Error("expected a batch")
    await queue.markConsumed([first.entry])

    // when
    const reset = await queue.resetConversation("conv")
    const next = await queue.enqueue(request([entry("user", "u3"), entry("assistant", "a3")]))
    if (!next.enqueued) throw new Error("expected a batch after reset")
    await queue.markConsumed([next.entry])

    // then
    expect(reset).toBe(true)
    expect(next.entry.range).toMatchObject({ start_line: 0, end_snapshot_line: 2 })
    expect(await queue.listPending()).toEqual([])
    const consumed = JSON.parse(await readFile(factsQueuePaths(paths).consumedPath, "utf8"))
    expect(consumed.consumed.conv.end_message_id).toBe("a3")
  })
})
