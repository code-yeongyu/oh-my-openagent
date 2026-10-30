import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { lutimes, mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { JournalLock } from "./lock"
import { sweepEmptyTranscriptJournals } from "./sweep"
import { removeTree } from "../../../../test-support/remove-tree"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

const NOW = Date.parse("2026-10-08T12:00:00.000Z")
const OLD = new Date(NOW - 60 * 60 * 1000)
const EMPTY_STATE = `${JSON.stringify({
  unreflected_bytes: 0,
  schema_version: "v3_assistant_steps",
  total_completed_steps: 0,
  reflected_completed_steps: 0,
  steps_since_last_successful_reflection: 0,
  reflected_through_byte_offset: 0,
}, null, 2)}\n`

async function transcriptsDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-sweep-")))
  tempDirs.push(dir)
  return dir
}

async function journal(
  root: string,
  sessionId: string,
  files: Record<string, string>,
  modifiedAt: Date = OLD,
): Promise<string> {
  const dir = join(root, sessionId)
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), content, "utf8")
    await utimes(join(dir, name), modifiedAt, modifiedAt)
    await utimes(dirname(join(dir, name)), modifiedAt, modifiedAt)
  }
  await utimes(dir, modifiedAt, modifiedAt)
  return dir
}

describe("empty transcript journal sweep (#9737)", () => {
  it("#given an old journal with an empty transcript and an empty state #when swept #then it is removed and counted", async () => {
    // given
    const root = await transcriptsDir()
    const dir = await journal(root, "control-1", { "transcript.jsonl": "", "state.json": EMPTY_STATE })

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW })

    // then
    expect(result.removed).toEqual(["control-1"])
    expect(existsSync(dir)).toBe(false)
  })

  it("#given journals that hold anything or are still in use #when swept #then every one is kept with its reason", async () => {
    // given
    const root = await transcriptsDir()
    const row = `${JSON.stringify({ kind: "user", text: "hi", captured_at: "x", source_line_id: "u1:user", source_message_id: "u1" })}\n`
    const keepers = [
      await journal(root, "with-transcript", { "transcript.jsonl": row, "state.json": EMPTY_STATE }),
      await journal(root, "with-steps", {
        "transcript.jsonl": "",
        "state.json": JSON.stringify({ schema_version: "v3_assistant_steps", total_completed_steps: 2 }),
      }),
      await journal(root, "with-reflection", {
        "transcript.jsonl": "",
        "state.json": JSON.stringify({ schema_version: "v3_assistant_steps", last_reflection_started_at: "2026-10-01T00:00:00.000Z" }),
      }),
      await journal(root, "with-unreadable-state", { "transcript.jsonl": "", "state.json": "{not json" }),
      await journal(root, "with-other-file", { "transcript.jsonl": "", "state.json": EMPTY_STATE, "notes.txt": "keep" }),
      await journal(root, "locked", { "transcript.jsonl": "", "state.json": EMPTY_STATE, "state.lock": "123\n" }),
      await journal(root, "recent", { "transcript.jsonl": "", "state.json": EMPTY_STATE }, new Date(NOW - 60 * 1000)),
      await journal(root, "live-session", { "transcript.jsonl": "", "state.json": EMPTY_STATE }),
      await journal(root, "with-subdirectory", { "transcript.jsonl": "", "state.json": EMPTY_STATE, "nested/file": "" }),
      await journal(root, "with-large-transcript", { "transcript.jsonl": " ".repeat(5000), "state.json": EMPTY_STATE }),
    ]

    // when
    const result = await sweepEmptyTranscriptJournals({
      transcriptsDir: root,
      now: () => NOW,
      isLive: (sessionId) => sessionId === "live-session",
    })

    // then
    expect(result.removed).toEqual([])
    for (const dir of keepers) expect(existsSync(dir)).toBe(true)
    expect(result.kept).toEqual({
      "transcript-content": 2,
      "state-content": 2,
      "state-unreadable": 1,
      "other-content": 2,
      locked: 1,
      recent: 1,
      live: 1,
    })
  })

  it("#given a whitespace-only transcript and a state file of zero bytes #when swept #then the journal still counts as empty", async () => {
    // given
    const root = await transcriptsDir()
    await journal(root, "blank", { "transcript.jsonl": "\n\n", "state.json": "" })

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW })

    // then
    expect(result.removed).toEqual(["blank"])
  })

  it("#given no transcripts directory, or one under a file #when swept #then nothing happens and nothing throws", async () => {
    // given
    const parent = await transcriptsDir()
    await writeFile(join(parent, "memory"), "not a directory", "utf8")

    // when
    const missing = await sweepEmptyTranscriptJournals({ transcriptsDir: join(parent, "missing"), now: () => NOW })
    const underFile = await sweepEmptyTranscriptJournals({ transcriptsDir: join(parent, "memory", "agents", "a", "runtime", "transcripts"), now: () => NOW })

    // then
    expect(missing).toEqual({ removed: [], kept: {} })
    expect(underFile).toEqual({ removed: [], kept: {} })
  })

  it("#given a journal whose only file is an empty state #when swept #then it is removed, so an interrupted sweep never strands it", async () => {
    // given
    const root = await transcriptsDir()
    await journal(root, "state-only", { "state.json": EMPTY_STATE })

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW })

    // then
    expect(result.removed).toEqual(["state-only"])
  })

  it("#given only one file or only the directory changed recently #when swept #then the journal is kept", async () => {
    // given
    const root = await transcriptsDir()
    const recentFile = await journal(root, "recent-file", { "transcript.jsonl": "", "state.json": EMPTY_STATE })
    await utimes(join(recentFile, "state.json"), new Date(NOW - 1000), new Date(NOW - 1000))
    const recentDir = await journal(root, "recent-dir", { "transcript.jsonl": "", "state.json": EMPTY_STATE })
    await utimes(recentDir, new Date(NOW - 1000), new Date(NOW - 1000))

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW })

    // then
    expect(result.removed).toEqual([])
    expect(result.kept).toEqual({ recent: 2 })
  })

  it("#given a writer appends the first row while the sweep waits for the journal lock #when the sweep gets the lock #then it re-checks, keeps the journal and the row", async () => {
    // given
    const root = await transcriptsDir()
    const dir = await journal(root, "racing", { "transcript.jsonl": "", "state.json": EMPTY_STATE })
    const row = `${JSON.stringify({ kind: "user", text: "hi", captured_at: "x", source_line_id: "u1:user", source_message_id: "u1" })}\n`
    const writerFirst: JournalLock = async (_lockPath, task) => {
      await writeFile(join(dir, "transcript.jsonl"), row, "utf8")
      await utimes(join(dir, "transcript.jsonl"), OLD, OLD)
      return task()
    }

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW, lock: writerFirst })

    // then
    expect(result.removed).toEqual([])
    expect(result.kept).toEqual({ "transcript-content": 1 })
    expect(await readFile(join(dir, "transcript.jsonl"), "utf8")).toBe(row)
  })

  it("#given another process holds the journal lock past the wait #when swept #then the journal is kept as locked", async () => {
    // given
    const root = await transcriptsDir()
    const dir = await journal(root, "contended", { "transcript.jsonl": "", "state.json": EMPTY_STATE })
    const contended: JournalLock = async (lockPath) => {
      const { JournalLockTimeoutError } = await import("./lock")
      throw new JournalLockTimeoutError(lockPath)
    }

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW, lock: contended })

    // then
    expect(result.kept).toEqual({ locked: 1 })
    expect(existsSync(dir)).toBe(true)
  })

  it("#given a journal whose transcript is a symlink to an empty file elsewhere #when swept #then it is kept and the target is untouched", async () => {
    // given
    const root = await transcriptsDir()
    const outside = join(await transcriptsDir(), "elsewhere.jsonl")
    await writeFile(outside, "", "utf8")
    const dir = await journal(root, "linked", { "state.json": EMPTY_STATE })
    await symlink(outside, join(dir, "transcript.jsonl"))
    await lutimes(join(dir, "transcript.jsonl"), OLD, OLD)
    await utimes(dir, OLD, OLD)

    // when
    const result = await sweepEmptyTranscriptJournals({ transcriptsDir: root, now: () => NOW })

    // then
    expect(result.kept).toEqual({ "other-content": 1 })
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(outside)).toBe(true)
  })
})
