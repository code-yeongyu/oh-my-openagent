import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { RetainTranscriptMark, TaskStatus } from "../state"
import { createTaskLifecycle } from "../lifecycle/create"
import type { ProcessSignaller } from "../lifecycle/port"
import { FakeRegistry, cleanupProjects, settings, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { TASK_ARCHIVE_CONTENT_CUSTOM_TYPE, TASK_ARCHIVE_CUSTOM_TYPE, parseArchiveLines } from "./archive"
import { readArchiveContent } from "./writer"

afterEach(cleanupProjects)

const now = () => 100_000_000
const TTL = 10_000

function iso(ageMs: number): string {
  return new Date(now() - ageMs).toISOString()
}

// st_00000004 sits in the retained success bucket for the default denominator (pinned by the
// selection tests), so a completed deep task with this id is deterministically archived.
const RETAINED_SUCCESS_ID = "st_00000004"
const DROPPED_SUCCESS_ID = "st_00000001"

type Fixture = {
  readonly store: ReturnType<typeof tempStore>
  readonly archiveDir: string
}

function fixture(): Fixture {
  const store = tempStore()
  const archiveDir = join(store.stateDir, "archive", "sessions", "--omo-senpi-task-archive--")
  return { store, archiveDir }
}

// Seed a terminal task with the visible artifacts the TTL sweep would find: an event log, a child
// session dir, and the completion spill.
function seedTerminalTask(
  fixture: Fixture,
  overrides: { task_id?: string; status?: TaskStatus; category?: string; retain_transcript?: RetainTranscriptMark; cwd?: string; terminalAgeMs?: number } = {},
): string {
  const taskId = overrides.task_id ?? RETAINED_SUCCESS_ID
  const terminal = iso(overrides.terminalAgeMs ?? TTL + 1)
  fixture.store.save({
    task_id: taskId,
    name: taskId,
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-6-astra",
    status: "completed",
    residency_state: "persisted_only",
    created_at: terminal,
    updated_at: terminal,
    terminal_at: terminal,
    final_response: "archived final answer",
    notify_on_terminal: false,
    notification: { run_epoch: 1, notified_epoch: 1 },
    ...(overrides.category !== undefined ? { category: overrides.category } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
    ...(overrides.retain_transcript !== undefined ? { retain_transcript: overrides.retain_transcript } : {}),
    spawn_spec: { version: 1, cwd: overrides.cwd ?? "/repo/checkout", prompt: "audit prompt" },
  })
  fixture.store.appendEvent(taskId, { type: "assistant_message", payload: { text: "visible assistant text" } })
  const childDir = join(fixture.store.stateDir, "children", taskId, "sessions", taskId)
  mkdirSync(childDir, { recursive: true })
  writeFileSync(join(childDir, "turn.jsonl"), '{"type":"message"}\n')
  return taskId
}

function lifecycleFor(fixture: Fixture, transcriptRetentionOverrides: Record<string, unknown> = {}) {
  const config: OmoTaskSettings = settings({
    ttl_ms: TTL,
    transcript_retention: {
      enabled: true,
      categories: ["deep"],
      ttl_ms: 604800000,
      max_bytes: 262144,
      success_sample_denominator: 4,
      metadata_only_paths: [],
      ...transcriptRetentionOverrides,
    },
  })
  return createTaskLifecycle({
    store: fixture.store,
    registry: new FakeRegistry(),
    config,
    transcriptArchiveDir: fixture.archiveDir,
    now,
    signaller: { isAlive: () => false, signal: () => {} } satisfies ProcessSignaller,
  })
}

function archiveFiles(fixture: Fixture): readonly string[] {
  return readdirSync(fixture.archiveDir).toSorted()
}

function readManifest(fixture: Fixture, fileName: string) {
  return parseArchiveLines(readFileSync(join(fixture.archiveDir, fileName), "utf8"))
}

describe("TTL sweep transcript retention", () => {
  test("#given a selected expired completed task #when the sweep runs #then the task is expunged and the compressed archive pair survives cleanup", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { retain_transcript: true })

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(existsSync(join(fx.store.stateDir, "tasks", `${taskId}.json`))).toBe(false)
    expect(existsSync(join(fx.store.stateDir, "children", taskId))).toBe(false)
    expect(existsSync(join(fx.store.stateDir, "logs", `${taskId}.jsonl`))).toBe(false)

    expect(archiveFiles(fx)).toHaveLength(2)
    const [manifestName, gzipName] = archiveFiles(fx)
    expect(manifestName?.endsWith(`_${taskId}.jsonl`)).toBe(true)
    expect(gzipName).toBe(`${manifestName}.gz`)

    const manifest = readManifest(fx, manifestName ?? "")
    expect(manifest[0]?.type).toBe("session")
    expect(manifest[0]?.cwd).toBe("/repo/checkout")
    const meta = manifest.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({
      task_id: taskId,
      parent_session_id: "parent-1",
      status: "completed",
      final_response: "archived final answer",
      retained_because: "explicit",
      content_retention: "full",
    })
    const pointer = manifest.find((line) => line.customType === TASK_ARCHIVE_CONTENT_CUSTOM_TYPE)
    expect(pointer?.data?.file).toBe(gzipName)

    const content = parseArchiveLines(readArchiveContent(readFileSync(join(fx.archiveDir, gzipName ?? ""))))
    expect(content.some((line) => line.message?.content?.[0]?.text === "visible assistant text")).toBe(true)
    expect(content.some((line) => line.message?.content?.[0]?.text === "audit prompt")).toBe(true)
  })

  test("#given an explicit metadata-only mark #when the sweep runs #then the manifest survives without any content sidecar", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { retain_transcript: "metadata" })

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(archiveFiles(fx)).toHaveLength(1)
    const meta = readManifest(fx, archiveFiles(fx)[0] ?? "").find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({ task_id: taskId, content_retention: "metadata-only" })
  })

  test("#given a protected cwd in metadata_only_paths #when the sweep archives a category-selected task #then only metadata survives", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { category: "deep", status: "error", cwd: "/home/dev/clinical" })

    const result = await lifecycleFor(fx, { metadata_only_paths: ["/home/dev/clinical"] }).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(archiveFiles(fx)).toHaveLength(1)
    const meta = readManifest(fx, archiveFiles(fx)[0] ?? "").find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({
      task_id: taskId,
      content_retention: "metadata-only",
      protected_by_path: true,
      retained_because: "category",
      status: "error",
    })
    // The seeded final response must NOT ride along on the downgraded artifact.
    expect(meta?.data).not.toHaveProperty("final_response")
    expect(readFileSync(join(fx.archiveDir, archiveFiles(fx)[0] ?? ""), "utf8")).not.toContain("archived final answer")
  })

  test("#given an unselected expired task #when the sweep runs #then it is expunged without an archival copy", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { task_id: DROPPED_SUCCESS_ID, category: "explore" })

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(existsSync(fx.archiveDir)).toBe(false)
  })

  test("#given an explicit retain_transcript false on a selected category #when the sweep runs #then no archive is written", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { task_id: DROPPED_SUCCESS_ID, category: "deep", retain_transcript: false })

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(existsSync(fx.archiveDir)).toBe(false)
  })

  test("#given a selected failed task outside the success sample #when the sweep runs #then its transcript is still archived", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { task_id: DROPPED_SUCCESS_ID, category: "deep", status: "error" })

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(archiveFiles(fx)).toHaveLength(2)
    const meta = readManifest(fx, archiveFiles(fx)[0] ?? "").find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({ task_id: DROPPED_SUCCESS_ID, status: "error", retained_because: "category" })
  })

  test("#given a fresh selected task #when the sweep runs #then it is retained and not yet archived", async () => {
    const fx = fixture()
    const taskId = seedTerminalTask(fx, { terminalAgeMs: TTL - 1 })

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.retained).toContain(taskId)
    expect(existsSync(fx.archiveDir)).toBe(false)
  })

  test("#given archive artifacts past the retention ttl #when the sweep runs #then expired manifests and sidecars are removed and fresh ones kept", async () => {
    const fx = fixture()
    mkdirSync(fx.archiveDir, { recursive: true })
    const names = ["stale.jsonl", "stale.jsonl.gz", "fresh.jsonl", "fresh.jsonl.gz"]
    for (const name of names) writeFileSync(join(fx.archiveDir, name), "{}\n")
    const stale = new Date(now() - 30 * 24 * 60 * 60 * 1000)
    const fresh = new Date(now() - 60_000)
    utimesSync(join(fx.archiveDir, "stale.jsonl"), stale, stale)
    utimesSync(join(fx.archiveDir, "stale.jsonl.gz"), stale, stale)
    utimesSync(join(fx.archiveDir, "fresh.jsonl"), fresh, fresh)
    utimesSync(join(fx.archiveDir, "fresh.jsonl.gz"), fresh, fresh)

    await lifecycleFor(fx).cleanupExpiredRecords()

    expect(existsSync(join(fx.archiveDir, "stale.jsonl"))).toBe(false)
    expect(existsSync(join(fx.archiveDir, "stale.jsonl.gz"))).toBe(false)
    expect(existsSync(join(fx.archiveDir, "fresh.jsonl"))).toBe(true)
    expect(existsSync(join(fx.archiveDir, "fresh.jsonl.gz"))).toBe(true)
  })

  test("#given an unusable archive dir #when the sweep runs #then cleanup still expunges the record", async () => {
    const fx = fixture()
    // A FILE where the archive dir must be created: every archive write fails.
    mkdirSync(join(fx.archiveDir, ".."), { recursive: true })
    writeFileSync(fx.archiveDir, "not a directory")
    const taskId = seedTerminalTask(fx)

    const result = await lifecycleFor(fx).cleanupExpiredRecords()

    expect(result.deleted).toContain(taskId)
    expect(existsSync(join(fx.store.stateDir, "tasks", `${taskId}.json`))).toBe(false)
  })
})
