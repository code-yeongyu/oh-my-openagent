import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { OmoTaskTranscriptRetention } from "@oh-my-opencode/omo-config-core"

import { createTaskRecordStore } from "../store"
import type { RetainTranscriptMark, TaskStatus } from "../state"
import { TASK_ARCHIVE_CONTENT_CUSTOM_TYPE, TASK_ARCHIVE_CUSTOM_TYPE, parseArchiveLines } from "./archive"
import { archiveFileName, createTranscriptArchiveWriter, readArchiveContent } from "./writer"

const cleanupRoots: string[] = []
afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = join(tmpdir(), `senpi-task-retention-${Math.random().toString(36).slice(2)}`)
  cleanupRoots.push(root)
  return root
}

function retentionSettings(overrides: Record<string, unknown> = {}): OmoTaskTranscriptRetention {
  return {
    enabled: true,
    categories: ["deep"],
    ttl_ms: 604800000,
    max_bytes: 262144,
    success_sample_denominator: 4,
    metadata_only_paths: [],
    ...overrides,
  } as OmoTaskTranscriptRetention
}

// st_00000004 sits in the retained success bucket for the default denominator (pinned by the
// selection tests), so a completed deep task with this id is deterministically archived.
const RETAINED_SUCCESS_ID = "st_00000004"

function seedTerminalTask(
  root: string,
  overrides: { task_id?: string; status?: TaskStatus; category?: string; retain_transcript?: RetainTranscriptMark } = {},
) {
  const store = createTaskRecordStore({ project_dir: root })
  const taskId = overrides.task_id ?? RETAINED_SUCCESS_ID
  const terminal = "2026-09-10T00:10:00.000Z"
  store.save({
    task_id: taskId,
    name: taskId,
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-6-astra",
    status: "completed",
    residency_state: "persisted_only",
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: terminal,
    terminal_at: terminal,
    notify_on_terminal: false,
    notification: { run_epoch: 1, notified_epoch: 1 },
    ...(overrides.category !== undefined ? { category: overrides.category } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
    ...(overrides.retain_transcript !== undefined ? { retain_transcript: overrides.retain_transcript } : {}),
    spawn_spec: { version: 1, cwd: root, prompt: "audit prompt" },
  })
  store.appendEvent(taskId, { type: "assistant_message", payload: { text: "visible assistant text" } })
  return { store, taskId }
}

function writerFor(root: string, store: ReturnType<typeof createTaskRecordStore>, settings: OmoTaskTranscriptRetention, overrides: { now?: () => number; archiveId?: () => string } = {}) {
  return createTranscriptArchiveWriter({
    stateDir: store.stateDir,
    archiveDir: join(root, "agent", "sessions", "--omo-senpi-task-archive--"),
    settings,
    now: overrides.now ?? (() => Date.parse("2026-09-11T00:00:00.000Z")),
    ...(overrides.archiveId !== undefined ? { archiveId: overrides.archiveId } : {}),
  })
}

function loadedRecord(store: ReturnType<typeof createTaskRecordStore>, taskId: string) {
  const record = store.load(taskId)
  if (record === null) throw new Error("seeded record vanished before the writer ran")
  return record
}

describe("createTranscriptArchiveWriter", () => {
  test("#given a selected terminal task #when archiving #then a 0600 manifest jsonl plus a 0600 compressed sidecar land under the archive dir", () => {
    const root = tempRoot()
    const { store, taskId } = seedTerminalTask(root, { retain_transcript: true })
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    const writer = writerFor(root, store, retentionSettings(), { archiveId: () => "11111111-2222-4333-8444-555555555555" })

    writer.archiveRecord(loadedRecord(store, taskId))

    const base = archiveFileName("2026-09-10T00:10:00.000Z", taskId).replace(/\.jsonl$/, "")
    const files = readdirSync(archiveDir).toSorted()
    expect(files).toEqual([`${base}.jsonl`, `${base}.jsonl.gz`])
    for (const file of files) {
      expect((statSync(join(archiveDir, file)).mode & 0o777).toString(8)).toBe("600")
    }
    expect((statSync(archiveDir).mode & 0o777).toString(8)).toBe("700")

    const manifest = parseArchiveLines(readFileSync(join(archiveDir, `${base}.jsonl`), "utf8"))
    expect(manifest[0]?.type).toBe("session")
    expect(manifest[0]?.cwd).toBe(root)
    const meta = manifest.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data?.task_id).toBe(taskId)

    // The compressed sidecar decompresses to a full session jsonl holding the visible transcript.
    const gzipBytes = readFileSync(join(archiveDir, `${base}.jsonl.gz`))
    const content = parseArchiveLines(readArchiveContent(gzipBytes))
    expect(content.some((line) => line.message?.content?.[0]?.text === "visible assistant text")).toBe(true)
    expect(content.some((line) => line.message?.content?.[0]?.text === "audit prompt")).toBe(true)
    expect(content.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)?.data?.content_retention).toBe("full")

    // The manifest pointer names the sidecar with a verifiable digest and sizes.
    const pointer = manifest.find((line) => line.customType === TASK_ARCHIVE_CONTENT_CUSTOM_TYPE)
    expect(pointer?.data).toEqual({
      file: `${base}.jsonl.gz`,
      sha256: createHash("sha256").update(gzipBytes).digest("hex"),
      compressed_bytes: gzipBytes.byteLength,
      uncompressed_bytes: Buffer.byteLength(readArchiveContent(gzipBytes), "utf8"),
      transcript_truncated: false,
    })
    // The compressed sidecar is actually smaller than the text it holds.
    expect(gzipBytes.byteLength).toBeLessThan(Buffer.byteLength(readArchiveContent(gzipBytes), "utf8"))
  })

  test("#given the same task archived twice #when archiving #then both artifacts are byte-identical (deterministic, idempotent)", () => {
    const root = tempRoot()
    const { store, taskId } = seedTerminalTask(root, { retain_transcript: true })
    const writer = writerFor(root, store, retentionSettings(), { archiveId: () => "11111111-2222-4333-8444-555555555555" })

    writer.archiveRecord(loadedRecord(store, taskId))
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    const first = readdirSync(archiveDir).toSorted().map((file) => readFileSync(join(archiveDir, file)))

    writer.archiveRecord(loadedRecord(store, taskId))
    const second = readdirSync(archiveDir).toSorted().map((file) => readFileSync(join(archiveDir, file)))

    expect(readdirSync(archiveDir)).toHaveLength(2)
    expect(first).toEqual(second)
  })

  test("#given a metadata-only mark #when archiving #then only the manifest is written and it holds audit facts but no content", () => {
    const root = tempRoot()
    const { store, taskId } = seedTerminalTask(root, { retain_transcript: "metadata" })
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    writerFor(root, store, retentionSettings(), { archiveId: () => "11111111-2222-4333-8444-555555555555" }).archiveRecord(loadedRecord(store, taskId))

    expect(readdirSync(archiveDir)).toEqual([archiveFileName("2026-09-10T00:10:00.000Z", taskId)])
    const manifestText = readFileSync(join(archiveDir, archiveFileName("2026-09-10T00:10:00.000Z", taskId)), "utf8")
    const lines = parseArchiveLines(manifestText)
    const meta = lines.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({ content_retention: "metadata-only", transcript_event_count: 1, status: "completed", parent_session_id: "parent-1" })
    expect(lines.some((line) => line.type === "message")).toBe(false)
    expect(lines.find((line) => line.customType === TASK_ARCHIVE_CONTENT_CUSTOM_TYPE)).toBeUndefined()
    // Neither the recorded prompt nor the recorded visible event text may leak into a metadata-only artifact.
    expect(manifestText).not.toContain("audit prompt")
    expect(manifestText).not.toContain("visible assistant text")
    expect(meta?.data).not.toHaveProperty("final_response")
  })

  test("#given a protected cwd under metadata_only_paths #when archiving a category-selected task #then only the metadata manifest is written", () => {
    const root = tempRoot()
    const { store, taskId } = seedTerminalTask(root, { category: "deep", status: "error" })
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    // The seeded record's cwd is the temp root itself: protect exactly it.
    const writer = writerFor(root, store, retentionSettings({ metadata_only_paths: [root] }))
    writer.archiveRecord(loadedRecord(store, taskId))

    expect(readdirSync(archiveDir)).toEqual([archiveFileName("2026-09-10T00:10:00.000Z", taskId)])
    const meta = parseArchiveLines(readFileSync(join(archiveDir, archiveFileName("2026-09-10T00:10:00.000Z", taskId)), "utf8"))
      .find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({ content_retention: "metadata-only", protected_by_path: true, retained_because: "category" })
  })

  test("#given an unselected terminal task #when archiving #then no archive file is created", () => {
    const root = tempRoot()
    const { store, taskId } = seedTerminalTask(root, { category: "explore" })
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    writerFor(root, store, retentionSettings()).archiveRecord(loadedRecord(store, taskId))
    expect(existsSync(archiveDir)).toBe(false)
  })

  test("#given retention disabled #when archiving #then nothing happens", () => {
    const root = tempRoot()
    const { store, taskId } = seedTerminalTask(root)
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    writerFor(root, store, retentionSettings({ enabled: false })).archiveRecord(loadedRecord(store, taskId))
    expect(existsSync(archiveDir)).toBe(false)
  })

  test("#given archive artifacts past their ttl #when expiring #then expired manifests and sidecars are removed together and fresh ones kept", () => {
    const root = tempRoot()
    const archiveDir = join(root, "agent", "sessions", "--omo-senpi-task-archive--")
    mkdirSync(archiveDir, { recursive: true })
    const files = ["old.jsonl", "old.jsonl.gz", "fresh.jsonl", "fresh.jsonl.gz", "unrelated.txt"]
    for (const file of files) writeFileSync(join(archiveDir, file), "{}\n")
    const writer = createTranscriptArchiveWriter({
      stateDir: join(root, "state"),
      archiveDir,
      settings: retentionSettings({ ttl_ms: 604800000 }),
      now: () => Date.parse("2026-09-11T00:00:00.000Z"),
    })
    // Seed mtimes directly: old is 30 days before the sweep, fresh is 1 minute before it.
    const stale = new Date(Date.parse("2026-08-01T00:00:00.000Z"))
    utimesSync(join(archiveDir, "old.jsonl"), stale, stale)
    utimesSync(join(archiveDir, "old.jsonl.gz"), stale, stale)
    const fresh = new Date(Date.parse("2026-09-10T23:59:00.000Z"))
    utimesSync(join(archiveDir, "fresh.jsonl"), fresh, fresh)
    utimesSync(join(archiveDir, "fresh.jsonl.gz"), fresh, fresh)

    const removed = writer.expireExpired()

    expect(removed).toEqual(["old.jsonl", "old.jsonl.gz"])
    expect(existsSync(join(archiveDir, "old.jsonl"))).toBe(false)
    expect(existsSync(join(archiveDir, "old.jsonl.gz"))).toBe(false)
    expect(existsSync(join(archiveDir, "fresh.jsonl"))).toBe(true)
    expect(existsSync(join(archiveDir, "fresh.jsonl.gz"))).toBe(true)
    expect(existsSync(join(archiveDir, "unrelated.txt"))).toBe(true)
  })

  test("#given a missing archive dir #when expiring #then it is a no-op", () => {
    const root = tempRoot()
    const writer = writerFor(root, createTaskRecordStore({ project_dir: root }), retentionSettings())
    expect(writer.expireExpired()).toEqual([])
  })
})
