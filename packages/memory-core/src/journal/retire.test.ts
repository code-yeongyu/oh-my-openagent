import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, readFile, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { RETIRED_IDS_FILE, readRetiredMessageKeys, retireTranscriptJournal } from "./retire"
import { TranscriptJournal } from "./store"
import { sweepEmptyTranscriptJournals } from "./sweep"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function transcriptsDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-retire-")))
  tempDirs.push(dir)
  return dir
}

const branch = [
  { kind: "user" as const, messageId: "user-1", text: "help me" },
  {
    kind: "assistant" as const,
    messageId: "assistant-1",
    textBlocks: ["done"],
    reasoningBlocks: ["thinking"],
    toolCalls: [{ callId: "tool-1", name: "read", resultText: "x".repeat(2000) }],
  },
  { kind: "assistant" as const, messageId: "assistant-2", textBlocks: ["more"] },
]

describe("transcript journal retirement", () => {
  it("#given a journaled branch #when retired and the branch is replayed #then nothing is journaled again", async () => {
    // given
    const root = await transcriptsDir()
    const journalDir = join(root, "session-a")
    const journal = new TranscriptJournal({ journalDir })
    await journal.reconcile(branch)

    // when
    const result = await retireTranscriptJournal(journalDir)
    const replay = await journal.reconcile(branch)

    // then
    expect(result).toMatchObject({ status: "retired", messages: 3 })
    expect(result.status === "retired" && result.freedBytes > 2000).toBe(true)
    expect(replay).toEqual({ appended: 0, skipped: 5 })
    expect(existsSync(join(journalDir, "transcript.jsonl"))).toBe(false)
    expect((await readRetiredMessageKeys(journalDir)).size).toBe(3)
    expect((await journal.getState()).total_completed_steps).toBe(0)
  })

  it("#given a retired journal #when the session continues #then only its new messages are journaled and retirement merges keys", async () => {
    // given
    const root = await transcriptsDir()
    const journalDir = join(root, "session-a")
    const journal = new TranscriptJournal({ journalDir })
    await journal.reconcile(branch)
    await retireTranscriptJournal(journalDir)

    // when
    const next = await journal.reconcile([...branch, { kind: "assistant", messageId: "assistant-3", textBlocks: ["new"] }])
    const rows = (await journal.readEntries()).map((entry) => entry.source_message_id)
    await retireTranscriptJournal(journalDir)

    // then
    expect(next).toEqual({ appended: 1, skipped: 5 })
    expect(rows).toEqual(["assistant-3"])
    expect((await journal.getState()).total_completed_steps).toBe(0)
    expect((await readRetiredMessageKeys(journalDir)).size).toBe(4)
  })

  it("#given a caller that refuses #when retiring #then the journal is left untouched", async () => {
    // given
    const root = await transcriptsDir()
    const journalDir = join(root, "session-a")
    await new TranscriptJournal({ journalDir }).reconcile(branch)
    const before = await readFile(join(journalDir, "transcript.jsonl"), "utf8")

    // when
    const result = await retireTranscriptJournal(journalDir, { beforeRetire: async () => false })

    // then
    expect(result).toEqual({ status: "refused" })
    expect(await readFile(join(journalDir, "transcript.jsonl"), "utf8")).toBe(before)
    expect(existsSync(join(journalDir, RETIRED_IDS_FILE))).toBe(false)
  })

  it("#given a retired journal idle past the sweep window #when empty journals are swept #then the retired marker is kept", async () => {
    // given
    const root = await transcriptsDir()
    const journalDir = join(root, "session-a")
    await new TranscriptJournal({ journalDir }).reconcile(branch)
    await retireTranscriptJournal(journalDir)
    const old = new Date("2026-01-01T00:00:00.000Z")
    for (const name of [RETIRED_IDS_FILE, "state.json"]) await utimes(join(journalDir, name), old, old)
    await utimes(journalDir, old, old)

    // when
    const swept = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => Date.parse("2026-02-01T00:00:00.000Z") })

    // then
    expect(swept.removed).toEqual([])
    expect(existsSync(join(journalDir, RETIRED_IDS_FILE))).toBe(true)
  })
})
