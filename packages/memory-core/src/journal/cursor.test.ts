import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { Buffer } from "node:buffer"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { REFLECTION_SNAPSHOT_MAX_BYTES, captureCursorSnapshot, deriveState, finalizeCursor, initialReflectionState } from "./cursor"
import { projectTranscriptEntries, type TranscriptEntry } from "./entries"
import { TranscriptJournal } from "./store"
import { realpathSync } from "node:fs"

function entryBytes(entries: readonly TranscriptEntry[]): number {
  return entries.reduce(
    (total, entry) => total + Buffer.byteLength(`${JSON.stringify(entry)}\n`, "utf8"),
    0,
  )
}

function assistantEntries(count: number, textLength: number): TranscriptEntry[] {
  return Array.from({ length: count }).flatMap((_, index) =>
    projectTranscriptEntries(
      {
        kind: "assistant",
        messageId: `assistant-${index}`,
        textBlocks: ["a".repeat(textLength)],
        toolCalls: [{ callId: `tool-${index}`, name: "read", resultText: "b".repeat(textLength) }],
      },
      "2026-08-09T12:00:00.000Z",
    ),
  )
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function createJournal(): Promise<TranscriptJournal> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-cursor-")))
  tempDirs.push(dir)
  let tick = 0
  return new TranscriptJournal({
    journalDir: dir,
    now: () => new Date(Date.UTC(2026, 7, 9, 12, 0, tick++)),
  })
}

describe("reflection cursor", () => {
  it("#given an aborted signal #when snapshot capture starts #then reflection state is not mutated", async () => {
    // given
    const journal = await createJournal()
    await journal.reconcile([
      { kind: "assistant", messageId: "assistant-1", textBlocks: ["first"] },
    ])
    const controller = new AbortController()
    controller.abort()

    // when
    const capture = journal.captureReflectionSnapshot(controller.signal)

    // then
    await expect(capture).rejects.toThrow()
    expect((await journal.getState()).last_reflection_started_at).toBeUndefined()
  })

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
    const transcript = await readFile(join(journal.options.journalDir, "transcript.jsonl"), "utf8")
    expect(state.reflected_through_byte_offset).toBe(Buffer.byteLength(transcript.split("\n").slice(0, 3).join("\n") + "\n", "utf8"))
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

  it("#given a backlog larger than the byte budget #when captured #then the oldest window fits, ends on a message boundary, and the remainder follows", () => {
    // given
    const entries = assistantEntries(40, 400)
    const state = deriveState(initialReflectionState(), entries)
    const maxBytes = 4096

    // when
    const snapshot = captureCursorSnapshot(entries, state, { maxBytes })

    // then
    if (snapshot === null) throw new Error("expected a reflection snapshot")
    expect(entryBytes(snapshot.entries)).toBeLessThanOrEqual(maxBytes)
    expect(snapshot.entries.length).toBeLessThan(entries.length)
    expect(snapshot.start_message_id).toBe("assistant-0")
    const boundary = entries[snapshot.end_snapshot_line]
    expect(boundary?.source_message_id).not.toBe(snapshot.end_message_id)
    expect(snapshot.entries.at(-1)?.source_message_id).toBe(snapshot.end_message_id)
    expect(snapshot.backlog_remaining).toBe(entries.length - snapshot.end_snapshot_line)
    expect(snapshot.backlog_remaining ?? 0).toBeGreaterThan(0)

    // and when the run succeeds the next capture returns exactly the remainder
    const finalized = finalizeCursor(state, entries, snapshot, true, "2026-08-09T12:00:05.000Z")
    expect(finalized.unreflected_bytes).toBe(entryBytes(entries.slice(snapshot.end_snapshot_line)))
    const next = captureCursorSnapshot(entries, finalized, { maxBytes })
    if (next === null) throw new Error("expected a follow-up snapshot")
    expect(next.start_line).toBe(snapshot.end_snapshot_line)
    expect(next.entries[0]).toEqual(entries[snapshot.end_snapshot_line] as TranscriptEntry)
  })

  it("#given a single message group larger than the budget #when captured #then that group still ships", () => {
    // given
    const entries = assistantEntries(3, 5000)
    const state = deriveState(initialReflectionState(), entries)
    const maxBytes = 512

    // when
    const snapshot = captureCursorSnapshot(entries, state, { maxBytes })

    // then
    if (snapshot === null) throw new Error("expected a reflection snapshot")
    expect(snapshot.end_message_id).toBe("assistant-0")
    expect(snapshot.entries.map((entry) => entry.source_message_id)).toEqual([
      "assistant-0",
      "assistant-0",
    ])
    expect(entryBytes(snapshot.entries)).toBeGreaterThan(maxBytes)
    expect(snapshot.backlog_remaining).toBe(entries.length - 2)
  })

  it("#given an unreflected backlog #when the state is persisted and reloaded #then unreflected_bytes round-trips", async () => {
    // given
    const journal = await createJournal()
    await journal.reconcile([
      { kind: "user", messageId: "user-1", text: "question" },
      { kind: "assistant", messageId: "assistant-1", textBlocks: ["first"] },
    ])

    // when
    const state = await journal.getState()
    const persisted: unknown = JSON.parse(await readFile(journal.statePath, "utf8"))

    // then
    const entries = await journal.readEntries()
    expect(state.unreflected_bytes).toBe(entryBytes(entries))
    expect((persisted as { unreflected_bytes?: number }).unreflected_bytes).toBe(state.unreflected_bytes)
    expect((await journal.getState()).unreflected_bytes).toBe(state.unreflected_bytes)
  })

  it("#given a tool-only tail after the last canonical message #when the whole backlog fits #then the tail ships in the same window", () => {
    // given
    const entries: TranscriptEntry[] = [
      ...assistantEntries(1, 20),
      ...projectTranscriptEntries(
        { kind: "assistant", messageId: "assistant-tail", toolCalls: [{ callId: "tail-tool", name: "read", resultText: "tail" }] },
        "2026-08-09T12:00:01.000Z",
      ),
    ]
    const state = deriveState(initialReflectionState(), entries)

    // when
    const snapshot = captureCursorSnapshot(entries, state, { maxBytes: 4096 })

    // then
    if (snapshot === null) throw new Error("expected a reflection snapshot")
    expect(snapshot.end_message_id).toBe("assistant-0")
    expect(snapshot.end_snapshot_line).toBe(entries.length)
    expect(snapshot.entries.at(-1)?.source_message_id).toBe("assistant-tail")
    expect(snapshot.backlog_remaining).toBeUndefined()
  })

  it("#given the default budget #when it is read #then it is 128 KiB", () => {
    expect(REFLECTION_SNAPSHOT_MAX_BYTES).toBe(131_072)
  })
})
