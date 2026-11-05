// Runtime retention seen from the adapter: the run-id allocator after a pass (H1), the transcript
// rebuild after a prune against REAL senpi session files (risk R1), and the per-agent policy.

import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, unlink, utimes, writeFile, readdir, lstat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SessionManager } from "@code-yeongyu/senpi"
import {
  DEFAULT_RUNTIME_RETENTION,
  TranscriptJournal,
  buildIdentityPaths,
  runRuntimeRetention,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"

import { projectSessionEntries } from "./journal-wiring"
import { resolveRuntimeRetentionPolicy } from "./memory-runtime-retention"
import { createReflectionRunIdFactory } from "./reflection-run-id"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-11-05T00:00:00.000Z")
const daysAgo = (days: number): number => NOW - days * DAY_MS
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function identity(): Promise<MemoryIdentityPaths> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-retention-adapter-")))
  roots.push(root)
  return buildIdentityPaths(root, "agent-test")
}

async function ageTree(path: string, at: number): Promise<void> {
  const stats = await lstat(path)
  if (stats.isDirectory()) for (const name of await readdir(path)) await ageTree(join(path, name), at)
  await utimes(path, new Date(at), new Date(at))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`)
}

async function foldedRun(paths: MemoryIdentityPaths, runId: string, finishedAt: number): Promise<void> {
  const dir = join(paths.reflection, "runs", runId)
  await writeJson(join(dir, "final.json"), { runId, outcome: "merged", finishedAt: new Date(finishedAt).toISOString() })
  await ageTree(dir, finishedAt)
}

async function consumedCompletion(paths: MemoryIdentityPaths, runId: string, finishedAt: number): Promise<void> {
  const path = join(paths.reflection, "completions", `${runId}.json`)
  await writeJson(path, {
    schemaVersion: 1, runId, identity: "agent-test", category: "quick", conversationIds: [], trigger: "manual",
    outcome: "merged", startedAt: new Date(finishedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(),
    delivery: { status: "consumed" },
  })
  await ageTree(path, finishedAt)
}

async function prune(paths: MemoryIdentityPaths, extra: { readonly warn?: (message: string) => void } = {}) {
  return runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now: () => NOW, ...extra })
}

async function mint(paths: MemoryIdentityPaths): Promise<string> {
  return createReflectionRunIdFactory({ identityPaths: paths })()
}

describe("run-id high water across a retention pass (H1)", () => {
  test("#given the highest trace in each of four stores and no run-id.json #when a full pass runs #then the next mint equals the pre-pass next id (A07, A26)", async () => {
    const shapes: Record<string, (paths: MemoryIdentityPaths) => Promise<void>> = {
      "folded run 30 d old": (paths) => foldedRun(paths, "reflection-run-20", daysAgo(30)),
      "consumed completion 60 d old": (paths) => consumedCompletion(paths, "reflection-run-20", daysAgo(60)),
      "legacy reflection-sessions entry": async (paths) => {
        await writeJson(join(paths.reflectionSessions, "reflection-run-20", "session.json"), {})
        await ageTree(paths.reflectionSessions, daysAgo(30))
      },
      "pending reservation": (paths) => writeJson(join(paths.reflection, "pending.json"), { runId: "reflection-run-20" }),
    }
    for (const [shape, write] of Object.entries(shapes)) {
      const paths = await identity()
      await foldedRun(paths, "reflection-run-4", daysAgo(30))
      await foldedRun(paths, "reflection-run-5", daysAgo(9))
      await consumedCompletion(paths, "reflection-run-3", daysAgo(60))
      await write(paths)

      await prune(paths)

      expect({ shape, next: await mint(paths) }).toEqual({ shape, next: "reflection-run-21" })
    }
  })

  test("#given run-id.json recorded by a pass #when the highest completion is later deleted by hand #then the mint still follows the mark, and without the mark it falls back to the scan (A26)", async () => {
    const paths = await identity()
    await foldedRun(paths, "reflection-run-5", daysAgo(1))
    await consumedCompletion(paths, "reflection-run-20", daysAgo(60))
    await prune(paths)
    const mark = JSON.parse(await readFile(join(paths.reflection, "run-id.json"), "utf8")) as { highWater: number }
    expect(mark.highWater).toBe(20)

    await unlink(join(paths.reflection, "completions", "reflection-run-20.json"))
    expect(await mint(paths)).toBe("reflection-run-21")
    const after = JSON.parse(await readFile(join(paths.reflection, "run-id.json"), "utf8")) as { highWater: number }
    expect(after.highWater).toBe(21)

    await unlink(join(paths.reflection, "run-id.json"))
    expect(await mint(paths)).toBe("reflection-run-6")
  })

  test("#given legacy reflection-sessions entries #when the pass removes the old ones #then the kept anchor still drives the mint (A22)", async () => {
    const paths = await identity()
    for (const runId of ["reflection-run-3", "reflection-run-9"]) await writeJson(join(paths.reflectionSessions, runId, "s.json"), {})
    await ageTree(paths.reflectionSessions, daysAgo(8))

    await prune(paths)

    expect(await mint(paths)).toBe("reflection-run-10")
  })
})

// Risk R1: a transcript-only prune is rebuilt from the harness. These tests build REAL senpi session
// files with SessionManager, compact them with a real compaction entry, reopen them from disk, and
// feed `getBranch()` through the production projection, exactly as journal-wiring does.
type Text = { readonly role: "user" | "assistant"; readonly text: string }
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

function append(manager: SessionManager, message: Text): string {
  return message.role === "user"
    ? manager.appendMessage({ role: "user", content: [{ type: "text", text: message.text }], timestamp: NOW })
    : manager.appendMessage({
        role: "assistant", content: [{ type: "text", text: message.text }], api: "anthropic-messages", provider: "fixture",
        model: "fixture", usage, stopReason: "stop", timestamp: NOW,
      })
}

interface PrunedSession {
  readonly paths: MemoryIdentityPaths
  readonly manager: SessionManager
  readonly ids: readonly string[]
  readonly journalDir: string
  readonly warnings: string[]
}

/** u1 a1 u2 a2 reflected through a2, then u3 a3 unreflected; the journal is then pruned as partly reflected. */
async function prunedSession(options: { readonly stamp: boolean }): Promise<PrunedSession> {
  const paths = await identity()
  const manager = SessionManager.create(paths.root, join(paths.root, "sessions"))
  const ids = [
    append(manager, { role: "user", text: "u1" }), append(manager, { role: "assistant", text: "a1" }),
    append(manager, { role: "user", text: "u2" }), append(manager, { role: "assistant", text: "a2" }),
  ]
  const journalDir = join(paths.transcripts, "session-r1")
  const warnings: string[] = []
  const journal = new TranscriptJournal({ journalDir, now: () => new Date(daysAgo(20)) })
  await journal.reconcile(projectSessionEntries(manager.getBranch()))
  const snapshot = await journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected a snapshot")
  await journal.finalizeReflection(snapshot, true)
  ids.push(append(manager, { role: "user", text: "u3" }), append(manager, { role: "assistant", text: "a3" }))
  await journal.reconcile(projectSessionEntries(manager.getBranch()))
  await ageTree(journalDir, daysAgo(20))
  if (options.stamp) {
    const report = await prune(paths)
    expect(report.journals.removed).toEqual(["session-r1"])
  } else {
    await unlink(join(journalDir, "transcript.jsonl"))
  }
  return { paths, manager, ids, journalDir, warnings }
}

function reopened(session: PrunedSession): ReturnType<typeof projectSessionEntries> {
  const file = session.manager.getSessionFile()
  if (file === undefined) throw new Error("expected a persisted session file")
  return projectSessionEntries(SessionManager.open(file).getBranch())
}

function journalOf(session: PrunedSession): TranscriptJournal {
  return new TranscriptJournal({ journalDir: session.journalDir, warn: (message) => session.warnings.push(message) })
}

describe("transcript rebuild after a prune against real senpi sessions (R1)", () => {
  test("#given a pruned partly-reflected journal #when the session resumes uncompacted #then the cursor lands after the anchor (A17)", async () => {
    const session = await prunedSession({ stamp: true })

    const journal = journalOf(session)
    await journal.reconcile(reopened(session))

    const state = await journal.getState()
    expect(state.reflected_through_message_id).toBe(session.ids[3])
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect((await journal.captureReflectionSnapshot())?.start_message_id).toBe(session.ids[4])
    expect(session.warnings).toEqual([])
  })

  test("#given a pruned journal and a compaction that kept the anchor but trimmed earlier steps #when the session resumes #then only the post-anchor step counts as unreflected (A17)", async () => {
    const session = await prunedSession({ stamp: true })
    session.manager.appendCompaction("summary of u1 a1", session.ids[2] ?? "", 1000)

    const journal = journalOf(session)
    const projection = reopened(session)
    expect(projection.map((message) => message.messageId)).toEqual(session.ids.slice(2))
    await journal.reconcile(projection)

    const state = await journal.getState()
    expect(state.reflected_through_message_id).toBe(session.ids[3])
    expect(state.reflected_completed_steps).toBe(1)
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect((await journal.captureReflectionSnapshot())?.start_message_id).toBe(session.ids[4])
  })

  test("#given a pruned journal and a compaction whose kept window starts after the anchor #when the session resumes #then every rebuilt row is unreflected and the loss is logged (A18)", async () => {
    const session = await prunedSession({ stamp: true })
    session.manager.appendCompaction("summary of u1 a1 u2 a2", session.ids[4] ?? "", 1000)
    const u4 = append(session.manager, { role: "user", text: "u4" })
    append(session.manager, { role: "assistant", text: "a4" })

    const journal = journalOf(session)
    const projection = reopened(session)
    expect(projection.map((message) => message.messageId).includes(session.ids[3] ?? "")).toBe(false)
    expect(projection[0]?.messageId).toBe(session.ids[4])
    await journal.reconcile(projection)

    const state = await journal.getState()
    expect(state.reflected_through_message_id).toBeUndefined()
    expect(state.reflected_completed_steps).toBe(0)
    expect(state.steps_since_last_successful_reflection).toBe(2)
    const snapshot = await journal.captureReflectionSnapshot()
    expect(snapshot?.start_message_id).toBe(session.ids[4])
    expect(snapshot?.entries.some((entry) => entry.source_message_id === u4)).toBe(true)
    expect(session.warnings).toEqual(["journal anchor lost after prune"])
  })

  test("#given a transcript removed without the prune stamp (control) #when the same compacted session resumes #then the old behaviour is unchanged (A18)", async () => {
    const session = await prunedSession({ stamp: false })
    session.manager.appendCompaction("summary of u1 a1 u2 a2", session.ids[4] ?? "", 1000)
    append(session.manager, { role: "user", text: "u4" })
    append(session.manager, { role: "assistant", text: "a4" })

    const journal = journalOf(session)
    await journal.reconcile(reopened(session))

    const state = await journal.getState()
    expect(state.reflected_through_message_id).toBe(session.ids[3])
    expect(state.reflected_completed_steps).toBe(2)
    expect(state.steps_since_last_successful_reflection).toBe(0)
    expect(session.warnings).toEqual([])
  })
})

describe("runtime retention settings (A24)", () => {
  test("#given root runtime settings and an agent override #when the policy resolves #then the agent value wins field by field", () => {
    const settings = OmoMemorySettingsSchema.parse({
      runtime: { retention_days: 3, abandoned_journal_days: 5 },
      agents: { "agent-test": { runtime: { retention_days: 30 } } },
    })

    expect(resolveRuntimeRetentionPolicy(settings, "agent-test")).toEqual({ retentionDays: 30, abandonedJournalDays: 5, completionsDays: 30 })
    expect(resolveRuntimeRetentionPolicy(settings, "other")).toEqual({ retentionDays: 3, abandonedJournalDays: 5, completionsDays: 30 })
    expect(resolveRuntimeRetentionPolicy(OmoMemorySettingsSchema.parse({}), "other")).toEqual({ retentionDays: 7, abandonedJournalDays: 14, completionsDays: 30 })
  })

  test("#given a policy with short windows #when the pass runs #then the predicates use the resolved values", async () => {
    const paths = await identity()
    await foldedRun(paths, "reflection-run-1", daysAgo(4))
    await foldedRun(paths, "reflection-run-2", daysAgo(4))
    await foldedRun(paths, "reflection-run-3", daysAgo(1))
    const policy = resolveRuntimeRetentionPolicy(OmoMemorySettingsSchema.parse({ runtime: { retention_days: 3 } }), "agent-test")

    const report = await runRuntimeRetention({ paths, policy, now: () => NOW })

    expect(report.runs.removed).toEqual(["reflection-run-1"])
  })
})
