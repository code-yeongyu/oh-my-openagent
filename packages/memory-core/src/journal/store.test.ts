import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TranscriptJournal } from "./store"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createJournal(): Promise<{ dir: string; journal: TranscriptJournal }> {
  const dir = await mkdtemp(join(tmpdir(), "memory-journal-"))
  tempDirs.push(dir)
  return {
    dir,
    journal: new TranscriptJournal({
      journalDir: dir,
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    }),
  }
}

describe("transcript journal store", () => {
  it("#given three completed assistant messages #when reconciled twice #then rows are idempotent and steps stay derived", async () => {
    // given
    const { dir, journal } = await createJournal()
    const messages = [
      { kind: "user" as const, messageId: "user-1", text: "help" },
      { kind: "assistant" as const, messageId: "assistant-1", textBlocks: ["one"] },
      {
        kind: "assistant" as const,
        messageId: "assistant-tool",
        toolCalls: [{ callId: "tool-1", name: "read" }],
      },
      { kind: "assistant" as const, messageId: "assistant-2", textBlocks: ["two"] },
      { kind: "assistant" as const, messageId: "assistant-3", textBlocks: ["three"] },
    ]

    // when
    const first = await journal.reconcile(messages)
    const second = await journal.reconcile(messages)
    const state = await journal.getState()
    const transcript = await readFile(join(dir, "transcript.jsonl"), "utf8")

    // then
    expect(first).toEqual({ appended: 5, skipped: 0 })
    expect(second).toEqual({ appended: 0, skipped: 5 })
    expect(transcript.trim().split("\n")).toHaveLength(5)
    expect(state).toEqual({
      schema_version: "v3_assistant_steps",
      total_completed_steps: 3,
      reflected_completed_steps: 0,
      steps_since_last_successful_reflection: 3,
    })
  })

  it("#given a stale derived counter on disk #when state is written #then the counter is recomputed", async () => {
    // given
    const { dir, journal } = await createJournal()
    await journal.reconcile([
      { kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] },
    ])
    await writeFile(
      join(dir, "state.json"),
      `${JSON.stringify({
        schema_version: "v3_assistant_steps",
        total_completed_steps: 1,
        reflected_completed_steps: 0,
        steps_since_last_successful_reflection: 99,
      })}\n`,
    )

    // when
    await journal.setPendingCompaction(true)
    const state = await journal.getState()

    // then
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect(state.pending_compaction).toBe(true)
  })
})
