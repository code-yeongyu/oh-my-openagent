import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TranscriptJournal } from "./store"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createJournal(): Promise<TranscriptJournal> {
  const dir = await mkdtemp(join(tmpdir(), "memory-cursor-"))
  tempDirs.push(dir)
  let tick = 0
  return new TranscriptJournal({
    journalDir: dir,
    now: () => new Date(Date.UTC(2026, 7, 9, 12, 0, tick++)),
  })
}

describe("reflection cursor", () => {
  it("#given rows appended during reflection #when the captured snapshot succeeds #then only snapshot rows become reflected", async () => {
    // given
    const journal = await createJournal()
    await journal.reconcile([
      { kind: "user", messageId: "user-1", text: "question" },
      {
        kind: "assistant",
        messageId: "assistant-1",
        textBlocks: ["first"],
        toolCalls: [{ callId: "tool-1", name: "read", resultText: "context" }],
      },
    ])
    const snapshot = await journal.captureReflectionSnapshot()
    expect(snapshot).not.toBeNull()
    if (snapshot === null) throw new Error("expected a reflection snapshot")
    await journal.reconcile([
      { kind: "assistant", messageId: "assistant-2", textBlocks: ["second"] },
    ])

    // when
    await journal.finalizeReflection(snapshot, true)
    const state = await journal.getState()

    // then
    expect(snapshot.end_message_id).toBe("assistant-1")
    expect(snapshot.end_snapshot_line).toBe(3)
    expect(snapshot.entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool_call"])
    expect(state.reflected_through_message_id).toBe("assistant-1")
    expect(state.total_completed_steps).toBe(2)
    expect(state.reflected_completed_steps).toBe(1)
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect(state.last_reflection_started_at).toBe("2026-08-09T12:00:01.000Z")
    expect(state.last_reflection_succeeded_at).toBe("2026-08-09T12:00:03.000Z")
  })

  it("#given a captured snapshot #when reflection fails #then the cursor remains retryable", async () => {
    // given
    const journal = await createJournal()
    await journal.reconcile([
      { kind: "assistant", messageId: "assistant-1", textBlocks: ["first"] },
    ])
    const snapshot = await journal.captureReflectionSnapshot()
    if (snapshot === null) throw new Error("expected a reflection snapshot")

    // when
    await journal.finalizeReflection(snapshot, false)
    const state = await journal.getState()

    // then
    expect(state.reflected_through_message_id).toBeUndefined()
    expect(state.reflected_completed_steps).toBe(0)
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect(await journal.captureReflectionSnapshot()).not.toBeNull()
  })
})
