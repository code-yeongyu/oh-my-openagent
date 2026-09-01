// Shared fixtures for the facts run pruning tests: temp identities, seeded terminal run dirs
// and a REAL child process holding a lock (readiness is signalled on stdout, never timed).

import { afterEach, expect } from "bun:test"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FactsQueueEntry } from "@oh-my-opencode/memory-core"

import { reserveFactsRunDir } from "./facts-run-storage"
import { exitedWithin } from "./worker/process-liveness.test-support"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

const holdLockFixture = join(import.meta.dir, "worker", "__fixtures__", "hold-lock.ts")
const temporaryRoots: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()

const TEARDOWN_GRACE_MS = 2_000

afterEach(async () => {
  // Temp roots die only after every tracked child is confirmed exited: rm under a live holder strands it.
  const tracked = [...children]
  children.clear()
  for (const child of tracked) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill("SIGTERM")
    if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
      child.kill("SIGKILL")
      if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
        throw new Error(`tracked lock holder pid ${String(child.pid)} survived SIGTERM and SIGKILL teardown`)
      }
    }
  }
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

export async function fixture(): Promise<{ readonly factsDir: string; readonly locksDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-facts-prune-"))
  temporaryRoots.push(root)
  const factsDir = join(root, "facts")
  const locksDir = join(root, "locks")
  await mkdir(join(factsDir, "runs"), { recursive: true })
  await mkdir(locksDir, { recursive: true })
  return { factsDir, locksDir }
}

/** A terminal run dir: ledger + matching sentinel, plus `bytes` of filler payload. */
export async function seedTerminalRun(options: {
  readonly factsDir: string
  readonly runId: string
  readonly finishedAt: string
  readonly sentinel?: "final.json" | "abandoned.json"
  readonly bytes?: number
  readonly ledgerRunId?: string
  readonly sentinelRunId?: string
}): Promise<string> {
  const runDir = join(options.factsDir, "runs", options.runId)
  await mkdir(runDir, { recursive: true })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId: options.ledgerRunId ?? options.runId,
    kind: "facts",
    startedAt: options.finishedAt,
    hardDeadlineAt: Date.parse(options.finishedAt),
    terminationGraceMs: 100,
    deadlineAt: Date.parse(options.finishedAt),
    batchId: "11111111-1111-4111-8111-111111111111",
    queued: [],
  })
  const sentinel = options.sentinel ?? "final.json"
  await writeRunJsonAtomic(join(runDir, sentinel), sentinel === "final.json"
    ? {
        version: 1,
        runId: options.sentinelRunId ?? options.runId,
        outcome: "committed",
        finishedAt: options.finishedAt,
        sha: "deadbeef",
      }
    : {
        version: 1,
        runId: options.sentinelRunId ?? options.runId,
        abandonedAt: options.finishedAt,
        reason: "unknown_liveness",
      })
  if (options.bytes !== undefined) {
    await writeFile(join(runDir, "child-stdout.log"), "x".repeat(options.bytes), "utf8")
  }
  return runDir
}

export async function seedNonTerminalRun(factsDir: string, runId: string): Promise<string> {
  const runDir = join(factsDir, "runs", runId)
  await mkdir(runDir, { recursive: true })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId,
    kind: "facts",
    startedAt: "2026-08-01T00:00:00.000Z",
    hardDeadlineAt: Date.parse("2026-08-01T00:01:00.000Z"),
    terminationGraceMs: 100,
    deadlineAt: Date.parse("2026-08-01T00:01:00.100Z"),
    batchId: "11111111-1111-4111-8111-111111111111",
    queued: [],
  })
  return runDir
}

export async function runNames(factsDir: string): Promise<readonly string[]> {
  return (await readdir(join(factsDir, "runs"))).sort()
}

export function instant(index: number): string {
  return new Date(Date.parse("2026-08-01T00:00:00.000Z") + index * 60_000).toISOString()
}

/** Spawns a live process that holds `lockPath` until killed; resolves once it is held. */
export async function holdLock(lockPath: string): Promise<void> {
  const child = spawn(process.execPath, [holdLockFixture, lockPath], { stdio: ["pipe", "pipe", "pipe"] })
  children.add(child)
  child.once("exit", () => children.delete(child))
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("lock holder never reported ready")), 10_000)
    let output = ""
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8")
      if (!output.includes("held\n")) return
      clearTimeout(timeout)
      child.stdout.off("data", onData)
      resolve()
    }
    child.stdout.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timeout)
      reject(new Error(`lock holder exited early: ${code}`))
    })
  })
}

export function runName(runDir: string): string {
  return runDir.split(/[\\/]/).pop() ?? ""
}

export function digestOf(runDir: string): string {
  return runName(runDir).split("-")[1] ?? ""
}

export async function reserveRun(factsDir: string, locksDir: string, at: string): Promise<string> {
  const runDir = await reserveFactsRunDir({
    factsDir,
    locksDir,
    entries: ENTRIES,
    batchId: "11111111-1111-4111-8111-111111111111",
    launchedAt: Date.parse(at),
  })
  expect(runDir).toBeDefined()
  return runDir ?? ""
}

export async function finalizeReserved(runDir: string, at: string): Promise<void> {
  await writeRunJsonAtomic(join(runDir, "final.json"), {
    version: 1,
    runId: runName(runDir),
    outcome: "committed",
    finishedAt: at,
    sha: "deadbeef",
  })
}

export const ENTRIES: readonly FactsQueueEntry[] = [{
  version: 1,
  identity: "facts-agent",
  conversationId: "session-1",
  sessionId: "session-1",
  enqueuedAt: "2026-08-01T00:00:00.000Z",
  range: { start_message_id: "m0", end_message_id: "m1", start_line: 1, end_snapshot_line: 1 },
  entries: [],
}]
