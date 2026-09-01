import { createHash } from "node:crypto"
import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { mkdir, readdir, rm } from "@oh-my-opencode/memory-core/fs"
import { basename, join } from "node:path"

import {
  createLockRecord,
  factsRunsLockPath,
  getPidLiveness,
  getProcessStartIdentity,
  withLock,
  type FactsQueueEntry,
} from "@oh-my-opencode/memory-core"

import { readRunJson, writeRunJsonAtomic } from "./worker/run-artifacts"
import { cleanupTerminalFactsRun, type RemoveRunArtifact } from "./facts-run-cleanup"
import type { FactsQueuedKey } from "./facts-failure-recording"
import type { FactsFinalRecord, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"

const DEFAULT_DEADLINE_MS = 15 * 60_000
const DEFAULT_GRACE_MS = 5_000
const RUNS_LOCK_WAIT_MS = 2_000

/**
 * Reserves the next free `facts-<digest>-<attempt>` dir. The scan, the mkdir and the ledger write
 * all happen under `facts-runs.lock` - the same lock retention pruning takes - so a name can never
 * be freed by pruning while this loop is probing it, and no existing dir is ever overwritten.
 * The attempt number is NOT a durable identity: see `nextAttempt`.
 */
export async function reserveFactsRunDir(options: {
  readonly factsDir: string
  readonly locksDir: string
  readonly entries: readonly FactsQueueEntry[]
  readonly batchId: string
  readonly launchedAt: number
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
  readonly lockWaitMs?: number
}): Promise<string | undefined> {
  const record = await createLockRecord("facts-runs", { runId: options.batchId })
  return withLock(
    factsRunsLockPath(options.locksDir),
    record,
    () => claimFactsRunDir(options),
    { waitTimeoutMs: options.lockWaitMs ?? RUNS_LOCK_WAIT_MS },
  )
}

async function claimFactsRunDir(options: {
  readonly factsDir: string
  readonly entries: readonly FactsQueueEntry[]
  readonly batchId: string
  readonly launchedAt: number
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
}): Promise<string | undefined> {
  const runsDir = join(options.factsDir, "runs")
  await mkdir(runsDir, { recursive: true, mode: 0o700 })
  const digest = createHash("sha256").update(JSON.stringify(queueKeys(options.entries))).digest("hex").slice(0, 12)
  const start = await nextAttempt(runsDir, digest)
  for (let attempt = start; attempt < 10_000; attempt += 1) {
    const runDir = join(runsDir, `facts-${digest}-${attempt}`)
    try {
      await mkdir(runDir, { mode: 0o700 })
      const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
      const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_GRACE_MS
      try {
        await writeRunJsonAtomic(join(runDir, "ledger.json"), {
          version: 1,
          runId: basename(runDir),
          kind: "facts",
          startedAt: new Date(options.launchedAt).toISOString(),
          hardDeadlineAt: options.launchedAt + deadlineMs,
          terminationGraceMs,
          deadlineAt: options.launchedAt + deadlineMs + terminationGraceMs,
          batchId: options.batchId,
          queued: queueKeys(options.entries),
        } satisfies FactsRunLedger)
      } catch (error) {
        await rm(runDir, { recursive: true, force: true })
        throw error
      }
      return runDir
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
      if (!existsSync(join(runDir, "final.json")) && !existsSync(join(runDir, "abandoned.json"))) return undefined
    }
  }
  throw new Error("facts run sequence exhausted")
}

/**
 * One past the highest attempt still ON DISK for this digest, tombstones included. That keeps the
 * sequence monotonic while any trace survives: retention can delete an older attempt while a newer
 * one lives, and restarting at the lowest FREE number would hand a reused name to a fresh run
 * beside a higher-numbered survivor.
 *
 * A name IS handed back once the highest attempt AND its tombstone are both gone - the high-water
 * mark is derived from disk, not persisted. Nothing depends on attempt numbers being unique over
 * time: no consumer orders runs by attempt, and failure-streak idempotency keys on the ledger's
 * per-launch `batchId` precisely so a reused name cannot masquerade as an earlier run's failure.
 */
async function nextAttempt(runsDir: string, digest: string): Promise<number> {
  const pattern = new RegExp(`^(?:\\.prune-)?facts-${digest}-(\\d+)(?:-|$)`)
  const names = await readdir(runsDir).catch(() => [] as string[])
  let highest = 0
  for (const name of names) {
    const attempt = Number(pattern.exec(name)?.[1] ?? Number.NaN)
    if (Number.isInteger(attempt) && attempt > highest) highest = attempt
  }
  return highest + 1
}

export async function writeFactsFinal(options: {
  readonly runDir: string
  readonly runId: string
  readonly outcome: "committed" | "no_facts" | "failed" | "parent_dirty"
  readonly now: () => Date
  readonly detail?: string
  readonly sha?: string
  readonly write?: (path: string, value: unknown) => Promise<void>
  readonly remove?: RemoveRunArtifact
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
}): Promise<void> {
  // Sentinel first (writeRunJsonAtomic fsyncs it), disposable artifacts second - never the
  // reverse: a crash before the sentinel must leave the payload for reconciliation to read.
  await (options.write ?? writeRunJsonAtomic)(join(options.runDir, "final.json"), {
    version: 1,
    runId: options.runId,
    outcome: options.outcome,
    finishedAt: options.now().toISOString(),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.sha === undefined ? {} : { sha: options.sha }),
  })
  await cleanupTerminalFactsRun({
    runDir: options.runDir,
    ...(options.remove === undefined ? {} : { remove: options.remove }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  })
}

export async function runLiveness(ledger: FactsRunLedger): Promise<"alive" | "dead" | "unknown"> {
  const identities = [
    [ledger.pid, ledger.processStart],
    [ledger.childPid, ledger.childProcessStart],
  ] as const
  let unknown = false
  for (const [pid, expectedStart] of identities) {
    if (pid === undefined) {
      unknown = true
      continue
    }
    const liveness = getPidLiveness(pid)
    if (liveness === "dead") continue
    if (liveness === "unknown" || expectedStart === null || expectedStart === undefined) {
      unknown = true
      continue
    }
    const actualStart = await getProcessStartIdentity(pid)
    if (actualStart === null) unknown = true
    else if (actualStart === expectedStart) return "alive"
  }
  return unknown ? "unknown" : "dead"
}

/**
 * The batch endpoints a run owns. `end_snapshot_line` rides along because the failure ledger
 * keys records by the snapshot boundary and reconciliation only ever has the ledger to work from.
 */
export function queueKeys(entries: readonly FactsQueueEntry[]): readonly FactsQueuedKey[] {
  return entries.map((entry) => ({
    conversationId: entry.conversationId,
    end_message_id: entry.range.end_message_id,
    end_snapshot_line: entry.range.end_snapshot_line,
  }))
}

export function finalResult(record: FactsFinalRecord): FactsLaunchResult {
  if (record.outcome === "committed" && record.sha !== undefined) {
    return { status: "committed", runId: record.runId, sha: record.sha }
  }
  if (record.outcome === "no_facts" || record.outcome === "parent_dirty") {
    return { status: record.outcome, runId: record.runId }
  }
  return { status: "failed", runId: record.runId }
}


export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined
}
