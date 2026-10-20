import { join } from "node:path"

import { existsSync, mkdir, rm } from "@oh-my-opencode/memory-core/fs"

import {
  FactsPlanParentDirtyError,
  GitMemoryRepo,
  LockContentionError,
  applyFactsRecovery,
  buildDefaultSeedFiles,
  createLockRecord,
  findFactsBatchReceipt,
  getProcessStartIdentity,
  memoryWriterLockPath,
  planFactsMutation,
  validateFactsRecovery,
  withLock,
  type FactsApplyRecovery,
  type FactsExtractionRecord,
  type FactsPeopleRouting,
  type MemoryIdentity,
  type parseFactsExtractionJsonl,
} from "@oh-my-opencode/memory-core"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { ComponentLogger } from "../../extension/types"
import { ensureIdentityRuntimeDirs } from "./context"
import type { FactsRunLedger } from "./facts-runner-types"
import { readRunJson, updateRunLedger, writeRunJsonAtomic } from "./worker/run-artifacts"

const WRITER_ATTEMPTS = 3

export type Applied =
  | { readonly outcome: "committed"; readonly sha: string; readonly affectedPaths: readonly string[] }
  | { readonly outcome: "parent_dirty"; readonly detail?: string }

/** The cross-process `memory-write` lock every facts apply takes (2 s wait per attempt). */
export async function withFactsWriterLock<T>(locksDir: string, operation: () => Promise<T>, attempt: number, runId = `facts-${attempt}`): Promise<T> {
  const record = await createLockRecord("memory-write", { runId })
  return withLock(memoryWriterLockPath(locksDir), record, operation, { waitTimeoutMs: 2_000 })
}

/** What an applied batch's envelope keeps so a later process can finish it (`request.json`). */
export interface AppliedFactsRequest {
  readonly records: readonly FactsExtractionRecord[]
  readonly people: FactsPeopleRouting
}

export function appliedFactsDir(factsDir: string): string {
  return join(factsDir, "applied")
}

// Envelopes this process is applying right now, shared across the entry bundle and the sidecar.
const ACTIVE_KEY = Symbol.for("omo.memory.facts.applied.active")
export function activeAppliedBatches(): Set<string> {
  const slot = globalThis as { [ACTIVE_KEY]?: Set<string> }
  return (slot[ACTIVE_KEY] ??= new Set())
}

/**
 * Applies records that did not come from a queued extractor run (a reviewed onboarding selection)
 * through the same `applyFactsWithRetries` path: same lock, same person routing, same batch receipt.
 * The batch's recovery envelope lives in `<facts>/applied/<batchId>/`: removed once the apply
 * reaches a terminal outcome, kept whenever it ends otherwise (a throw, or a busy memory-write lock)
 * with a planned recovery on disk, so the facts maintenance reconcile (`facts-applied-reconcile.ts`)
 * or a retry with the same batchId finishes it.
 */
export async function applyFactsWithRetriesUnderLock(options: {
  readonly identity: MemoryIdentity
  readonly batchId: string
  readonly records: readonly FactsExtractionRecord[]
  readonly people: FactsPeopleRouting
  readonly logger?: ComponentLogger
  readonly now?: () => Date
}): Promise<Applied | undefined> {
  await ensureIdentityRuntimeDirs(options.identity.paths)
  const repo = new GitMemoryRepo({ dir: options.identity.paths.repo, agentId: options.identity.id })
  if (!existsSync(join(repo.dir, ".git"))) await repo.init({ seedFiles: buildDefaultSeedFiles() })
  const runDir = join(appliedFactsDir(options.identity.paths.facts), options.batchId)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const ledgerPath = join(runDir, "ledger.json")
  const owner = { pid: process.pid, processStart: await getProcessStartIdentity(process.pid) }
  const kept = await readRunJson<FactsRunLedger>(ledgerPath).catch(() => undefined)
  const resumed = kept?.batchId === options.batchId && kept.applyRecovery !== undefined
  const startedAt = (options.now ?? (() => new Date()))()
  const ledger: FactsRunLedger = resumed ? { ...kept, ...owner } : {
    version: 1,
    runId: `apply-${options.batchId}`,
    kind: "facts",
    startedAt: startedAt.toISOString(),
    hardDeadlineAt: startedAt.getTime(),
    terminationGraceMs: 0,
    deadlineAt: startedAt.getTime(),
    batchId: options.batchId,
    queued: [],
    ...owner,
  }
  activeAppliedBatches().add(runDir)
  let settled = false
  try {
    if (!resumed) {
      const request: AppliedFactsRequest = { records: options.records, people: options.people }
      await writeRunJsonAtomic(join(runDir, "request.json"), request)
    }
    await writeRunJsonAtomic(ledgerPath, ledger)
    const applied = await applyFactsWithRetries({
      runDir,
      ledger,
      repo,
      records: [...options.records],
      people: options.people,
      identity: options.identity,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      withWriterLock: (operation, attempt) => withFactsWriterLock(options.identity.paths.locks, operation, attempt, ledger.runId),
    })
    settled = applied !== undefined
    return applied
  } finally {
    // A throw or an exhausted lock is not terminal: the on-disk ledger, not this call's path, says
    // whether a planned recovery exists. Kept envelopes are unowned, so any later reconcile finishes them.
    const onDisk = settled ? undefined : await readRunJson<FactsRunLedger>(ledgerPath).catch(() => undefined)
    if (onDisk?.applyRecovery !== undefined) await writeRunJsonAtomic(ledgerPath, { ...onDisk, pid: undefined, processStart: undefined })
    activeAppliedBatches().delete(runDir)
    if (onDisk?.applyRecovery === undefined) await rm(runDir, { recursive: true, force: true })
  }
}

export function resolveFactsPeopleRouting(config: OmoConfig, identity: string): FactsPeopleRouting {
  const memory = config.memory
  const override = memory?.agents[identity]?.people
  return {
    enabled: override?.enabled ?? memory?.people.enabled ?? true,
    maxEntries: override?.max_entries ?? memory?.people.max_entries ?? 40,
    maxEntryChars: override?.max_entry_chars ?? memory?.people.max_entry_chars ?? 200,
  }
}

export async function applyFactsWithRetries(options: {
  readonly runDir: string
  readonly ledger: FactsRunLedger
  readonly repo: GitMemoryRepo
  readonly records: ReturnType<typeof parseFactsExtractionJsonl>
  readonly people: FactsPeopleRouting
  readonly identity: MemoryIdentity
  readonly logger?: ComponentLogger
  readonly withWriterLock: <T>(operation: () => Promise<T>, attempt: number) => Promise<T>
  readonly retryDelay?: (attempt: number, delayMs: number) => Promise<void>
  readonly random?: () => number
}): Promise<Applied | undefined> {
  for (let attempt = 1; attempt <= WRITER_ATTEMPTS; attempt += 1) {
    try {
      return await options.withWriterLock(async () => applyClaimed(options), attempt)
    } catch (error) {
      if (!(error instanceof LockContentionError)) throw error
      if (attempt === WRITER_ATTEMPTS) {
        options.logger?.warn("facts extractor memory-write lock exhausted", { runId: options.ledger.runId })
        return undefined
      }
      const jitter = 25 + Math.floor((options.random ?? Math.random)() * 76)
      await (options.retryDelay ?? delay)(attempt, jitter)
    }
  }
  return undefined
}

async function applyClaimed(options: {
  readonly runDir: string
  readonly ledger: FactsRunLedger
  readonly repo: GitMemoryRepo
  readonly records: ReturnType<typeof parseFactsExtractionJsonl>
  readonly people: FactsPeopleRouting
  readonly identity: MemoryIdentity
  readonly logger?: ComponentLogger
}): Promise<Applied> {
  const receipt = await findFactsBatchReceipt(options.repo, options.ledger.batchId)
  if (receipt !== undefined) return { outcome: "committed", sha: receipt.sha, affectedPaths: await receiptPaths(options.repo, receipt.sha, options.ledger.batchId) }
  const batch = { batchId: options.ledger.batchId, records: options.records }
  let recovery: FactsApplyRecovery
  if (options.ledger.applyRecovery !== undefined) {
    recovery = options.ledger.applyRecovery
    validateFactsRecovery(recovery, batch)
  } else {
    try {
      recovery = await planFactsMutation(options.repo, batch, options.people, (tie) => options.logger?.warn(
        "facts person alias tie resolved by slug order",
        { alias: tie.alias, slugs: tie.slugs.join(","), chosen: tie.chosen },
      ))
    } catch (error) {
      if (error instanceof FactsPlanParentDirtyError) return { outcome: "parent_dirty" }
      throw error
    }
    await updateRunLedger(`${options.runDir}/ledger.json`, {
      headBeforeApply: recovery.headBeforeApply,
      applyRecovery: recovery,
    })
  }
  const result = await applyFactsRecovery(options.repo, recovery, options.records.length, {
    agentId: options.identity.id,
    authorName: "Facts Extractor",
  })
  return result.outcome === "parent_dirty"
    ? result
    : { outcome: "committed", sha: result.sha, affectedPaths: result.affectedPaths }
}

// A batch answered from its receipt (a retried client batchId) reports the paths that commit wrote.
async function receiptPaths(repo: GitMemoryRepo, sha: string, batchId: string): Promise<readonly string[]> {
  const commits = await repo.log({ includePaths: true, grep: [`Omo-Facts-Batch: ${batchId}`] })
  return commits.find((commit) => commit.sha === sha)?.paths ?? []
}

function delay(_attempt: number, milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
