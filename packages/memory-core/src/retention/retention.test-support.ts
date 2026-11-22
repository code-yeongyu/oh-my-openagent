// Fixtures for the runtime retention tests: a fake identity under a temp memory root, a pinned
// clock, and writers for every store the pass reads. Ages are set with utimes against the pinned
// clock, never wall time.

import { mkdtemp, readdir, rm, utimes, writeFile, mkdir, lstat, chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentityPaths } from "../identity/layout"
import { TranscriptJournal } from "../journal/store"

export const DAY_MS = 24 * 60 * 60 * 1000
export const NOW = Date.parse("2026-11-05T00:00:00.000Z")
export const now = (): number => NOW
export const daysAgo = (days: number): number => NOW - days * DAY_MS
export const iso = (ms: number): string => new Date(ms).toISOString()

const roots: string[] = []

export async function cleanupRoots(): Promise<void> {
  for (const root of roots.splice(0)) {
    await chmodTree(root).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}

async function chmodTree(path: string): Promise<void> {
  const stats = await lstat(path)
  if (!stats.isDirectory()) return
  await chmod(path, 0o700)
  for (const name of await readdir(path)) await chmodTree(join(path, name))
}

export async function identity(): Promise<MemoryIdentityPaths> {
  const root = await mkdtemp(join(tmpdir(), "memory-retention-"))
  roots.push(root)
  return buildIdentityPaths(root, "agent-test")
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Sets the mtime of `path` and everything under it (directories last, so writes do not move them). */
export async function ageTree(path: string, at: number): Promise<void> {
  const stats = await lstat(path)
  if (stats.isDirectory()) {
    for (const name of await readdir(path)) await ageTree(join(path, name), at)
  }
  const when = new Date(at)
  await utimes(path, when, when)
}

export function runsDir(paths: MemoryIdentityPaths): string {
  return join(paths.reflection, "runs")
}

export function completionsDir(paths: MemoryIdentityPaths): string {
  return join(paths.reflection, "completions")
}

export type RunShape = {
  readonly outcome?: string
  readonly finishedAt?: number
  readonly mtime?: number
  readonly finalRunId?: string
  readonly sentinel?: "final" | "abandoned" | "quarantined" | "none"
  readonly readOnlyPayload?: boolean
  /** Write time of an abandoned/quarantined sentinel; defaults to `finishedAt`. */
  readonly sentinelWrittenAt?: number
}

/** A reflection run dir with a ledger, a child log and the requested terminal sentinel. */
export async function reflectionRun(paths: MemoryIdentityPaths, runId: string, shape: RunShape = {}): Promise<string> {
  const dir = join(runsDir(paths), runId)
  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, "ledger.json"), { runId })
  await writeFile(join(dir, "child-1.log"), "child output\n")
  const finishedAt = shape.finishedAt ?? daysAgo(8)
  const sentinel = shape.sentinel ?? "final"
  if (sentinel === "final") {
    await writeJson(join(dir, "final.json"), {
      runId: shape.finalRunId ?? runId,
      outcome: shape.outcome ?? "merged",
      finishedAt: iso(finishedAt),
    })
  } else if (sentinel === "abandoned") {
    await writeJson(join(dir, "abandoned.json"), {
      runId,
      reason: "launch_interrupted",
      generation: iso(finishedAt),
      abandonedAt: iso(shape.sentinelWrittenAt ?? finishedAt),
    })
  } else if (sentinel === "quarantined") {
    await writeJson(join(dir, "quarantined.json"), {
      runId,
      reason: "ledger_unreadable",
      generation: iso(finishedAt),
      quarantinedAt: iso(shape.sentinelWrittenAt ?? finishedAt),
    })
  }
  if (shape.readOnlyPayload === true) await readOnlyPayload(dir)
  await ageTree(dir, shape.mtime ?? finishedAt)
  return dir
}

/** The three payload files the reflection worker chmods to 0o400 (worker/spawn-payload.ts). */
export async function readOnlyPayload(dir: string): Promise<void> {
  for (const name of ["reflection-persona.md", "reflection-task.md", "transcript-payload.json"]) {
    const path = join(dir, name)
    await writeFile(path, "payload\n")
    await chmod(path, 0o400)
  }
}

export async function completion(
  paths: MemoryIdentityPaths,
  runId: string,
  shape: { readonly status?: "pending" | "consumed"; readonly finishedAt?: number } = {},
): Promise<string> {
  const path = join(completionsDir(paths), `${runId}.json`)
  const finishedAt = shape.finishedAt ?? daysAgo(31)
  await writeJson(path, {
    schemaVersion: 1,
    runId,
    identity: "agent-test",
    category: "quick",
    conversationIds: ["conversation-a"],
    trigger: "manual",
    outcome: "merged",
    startedAt: iso(finishedAt - 60_000),
    finishedAt: iso(finishedAt),
    durationMs: 60_000,
    consecutiveFailures: 0,
    delivery: { status: shape.status ?? "consumed" },
  })
  await ageTree(path, finishedAt)
  return path
}

export async function reservation(
  paths: MemoryIdentityPaths,
  file: "active.lock" | "pending.json",
  runId: string,
): Promise<void> {
  await writeJson(join(paths.reflection, file), {
    runId,
    reservedAt: iso(daysAgo(1)),
    request: { trigger: "manual", conversationIds: [] },
  })
}

export async function runIdMark(paths: MemoryIdentityPaths, highWater: number): Promise<void> {
  await writeJson(join(paths.reflection, "run-id.json"), { version: 1, highWater })
}

export type JournalShape = "fully" | "partly" | "never" | "no-steps"

/** A real journal built through TranscriptJournal, then aged. */
export async function journal(
  paths: MemoryIdentityPaths,
  sessionId: string,
  shape: JournalShape,
  idleSince: number,
  options: { readonly pendingCompaction?: boolean } = {},
): Promise<string> {
  const dir = join(paths.transcripts, sessionId)
  const store = new TranscriptJournal({ journalDir: dir, now: () => new Date(idleSince) })
  if (shape === "no-steps") {
    await store.reconcile([{ kind: "user", messageId: "u1", text: "hello" }])
  } else {
    await store.reconcile([
      { kind: "user", messageId: "u1", text: "first" },
      { kind: "assistant", messageId: "a1", textBlocks: ["first answer"] },
    ])
    if (shape !== "never") {
      const snapshot = await store.captureReflectionSnapshot()
      if (snapshot === null) throw new Error("expected a snapshot")
      await store.finalizeReflection(snapshot, true)
    }
    if (shape === "partly") {
      await store.reconcile([
        { kind: "user", messageId: "u1", text: "first" },
        { kind: "assistant", messageId: "a1", textBlocks: ["first answer"] },
        { kind: "user", messageId: "u2", text: "second" },
        { kind: "assistant", messageId: "a2", textBlocks: ["second answer"] },
      ])
    }
  }
  if (options.pendingCompaction === true) await store.setPendingCompaction(true)
  await ageTree(dir, idleSince)
  return dir
}

export async function sidecar(paths: MemoryIdentityPaths, sessionId: string, at: number): Promise<string> {
  const dir = join(paths.recall, "sidecars", Buffer.from(sessionId, "utf8").toString("base64url"))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "wakes.ndjson"), "{}\n")
  await ageTree(dir, at)
  return dir
}

/** A pid the kernel no longer knows: a child that has already exited and been reaped. */
export function exitedPid(): number {
  const child = Bun.spawnSync([process.execPath, "-e", ""])
  if (child.exitCode !== 0 || child.pid === undefined) throw new Error("could not spawn a short-lived child")
  return child.pid
}
