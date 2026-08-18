// Retention pruning for terminal facts run dirs.
//
// THE LOCKING IS THE CONTRACT. Three rules, each protecting a distinct failure mode:
//
// 1. `facts-runs.lock` covers selection AND the tombstone rename, and reservation takes the same
//    lock for its scan+mkdir+ledger write. Without it, pruning could free `facts-<digest>-<n>`
//    while a reservation for the same digest is probing that exact name, and the EEXIST attempt
//    loop would hand out a name a concurrent reader still believes is terminal.
// 2. The tombstone is renamed under the lock but deleted AFTER releasing it: `rm -rf` of a big
//    run dir is unbounded work and must never block reservation. A crash in that window leaves a
//    `.prune-*` dir, which session-start maintenance sweeps.
// 3. A run is only prunable if its own finalize lock can be taken non-blocking. A run being
//    finalized right now is still reading its own dir, so a busy lock means SKIP, never wait.
//
// Selection is deliberately conservative: only dirs whose ledger AND sentinel agree with the
// directory name are candidates. Anything malformed, non-terminal or partially reserved is
// invisible to pruning - the disk cost of keeping it is bounded, the cost of deleting a run that
// reconciliation still needs is not. The newest terminal run is ALWAYS kept, even when it alone
// blows the byte cap: retention exists to bound growth, not to erase the run a user just made.

import { randomUUID } from "node:crypto"
import { lstat, readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"

import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  factsRunsLockPath,
  releaseLock,
  runFinalizationLockPath,
  withLock,
} from "@oh-my-opencode/memory-core"

import { PRUNE_TOMBSTONE_PREFIX } from "./facts-run-cleanup"
import { describe } from "./facts-run-storage"
import { readRunJson } from "./worker/run-artifacts"
import type { FactsRunLedger } from "./facts-runner-types"

export const FACTS_RUN_KEEP_LAST = 20
export const FACTS_RUN_MAX_TOTAL_BYTES = 128 * 1024 * 1024
const RUNS_LOCK_WAIT_MS = 2_000

interface TerminalRun {
  readonly name: string
  readonly finishedAt: number
  readonly bytes: number
}

export interface PruneTerminalFactsRunsOptions {
  readonly factsDir: string
  readonly locksDir: string
  readonly keepLast?: number
  readonly maxTotalBytes?: number
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
  /** Test seam: observed after the runs lock is released, before the tombstone is deleted. */
  readonly beforeTombstoneDelete?: (tombstone: string) => void | Promise<void>
}

export interface PruneTerminalFactsRunsResult {
  readonly pruned: readonly string[]
}

/** Prunes terminal run dirs beyond the keep-last count or the total byte cap. */
export async function pruneTerminalFactsRuns(
  options: PruneTerminalFactsRunsOptions,
): Promise<PruneTerminalFactsRunsResult> {
  const runsDir = join(options.factsDir, "runs")
  const claimed = await withFactsRunsLock(options.locksDir, async () => {
    const candidates = await selectPrunable(runsDir, options)
    const renamed: { readonly name: string; readonly tombstone: string }[] = []
    for (const name of candidates) {
      const tombstone = await claimForPruning(runsDir, options.locksDir, name)
      if (tombstone !== undefined) renamed.push({ name, tombstone })
    }
    return renamed
  })
  const pruned: string[] = []
  for (const { name, tombstone } of claimed) {
    await options.beforeTombstoneDelete?.(join(runsDir, tombstone))
    try {
      await rm(join(runsDir, tombstone), { recursive: true, force: true })
    } catch (error) {
      // The tombstone name is already unreachable by reservation; the sweep retries it.
      options.warn?.("facts run tombstone deletion failed", { tombstone, error: describe(error) })
      continue
    }
    pruned.push(name)
  }
  return { pruned }
}

/** Newest-first survivors under both limits; everything after them is prunable. */
async function selectPrunable(
  runsDir: string,
  options: PruneTerminalFactsRunsOptions,
): Promise<readonly string[]> {
  const keepLast = options.keepLast ?? FACTS_RUN_KEEP_LAST
  const maxTotalBytes = options.maxTotalBytes ?? FACTS_RUN_MAX_TOTAL_BYTES
  const runs = await readTerminalRuns(runsDir)
  const prunable: string[] = []
  let total = 0
  for (const [index, run] of runs.entries()) {
    total += run.bytes
    // The newest terminal run is never prunable, whatever the limits say.
    if (index === 0) continue
    if (index >= keepLast || total > maxTotalBytes) prunable.push(run.name)
  }
  return prunable
}

/** Terminal runs sorted newest-first, finishedAt then run id (both descending). */
async function readTerminalRuns(runsDir: string): Promise<readonly TerminalRun[]> {
  const names = await readdir(runsDir).catch(() => [] as string[])
  const runs: TerminalRun[] = []
  for (const name of names) {
    if (!name.startsWith("facts-")) continue
    const run = await readTerminalRun(runsDir, name)
    if (run !== undefined) runs.push(run)
  }
  return runs.sort((left, right) =>
    right.finishedAt - left.finishedAt || (left.name < right.name ? 1 : left.name > right.name ? -1 : 0))
}

/** A run is terminal only when ledger, sentinel and directory name all name the same run. */
async function readTerminalRun(runsDir: string, name: string): Promise<TerminalRun | undefined> {
  const runDir = join(runsDir, name)
  const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json")).catch(() => undefined)
  if (ledger?.runId !== name) return undefined
  const record = await readSentinel(runDir)
  if (record === undefined || record.runId !== name) return undefined
  const finishedAt = Date.parse(record.at)
  if (Number.isNaN(finishedAt)) return undefined
  return { name, finishedAt, bytes: await directoryBytes(runDir) }
}

async function readSentinel(runDir: string): Promise<{ readonly runId: string; readonly at: string } | undefined> {
  const final = await readRunJson<{ runId?: unknown; finishedAt?: unknown }>(join(runDir, "final.json"))
    .catch(() => undefined)
  if (final !== undefined) {
    return typeof final.runId === "string" && typeof final.finishedAt === "string"
      ? { runId: final.runId, at: final.finishedAt }
      : undefined
  }
  const abandoned = await readRunJson<{ runId?: unknown; abandonedAt?: unknown }>(join(runDir, "abandoned.json"))
    .catch(() => undefined)
  if (abandoned === undefined) return undefined
  return typeof abandoned.runId === "string" && typeof abandoned.abandonedAt === "string"
    ? { runId: abandoned.runId, at: abandoned.abandonedAt }
    : undefined
}

/** Recursive apparent size via lstat: symlinks count as their own entry, never followed. */
async function directoryBytes(path: string): Promise<number> {
  const stats = await lstat(path).catch(() => undefined)
  if (stats === undefined) return 0
  if (!stats.isDirectory()) return stats.size
  const names = await readdir(path).catch(() => [] as string[])
  let total = stats.size
  for (const name of names) total += await directoryBytes(join(path, name))
  return total
}

/** Renames the run away under its own finalize lock; a busy lock means skip, never wait. */
async function claimForPruning(
  runsDir: string,
  locksDir: string,
  name: string,
): Promise<string | undefined> {
  const record = await createLockRecord("facts-finalize", { runId: name })
  const finalizeLock = runFinalizationLockPath(locksDir, name)
  try {
    await acquireLock(finalizeLock, record)
  } catch (error) {
    if (error instanceof LockContentionError) return undefined
    throw error
  }
  try {
    const tombstone = `${PRUNE_TOMBSTONE_PREFIX}${name}-${randomUUID()}`
    await rename(join(runsDir, name), join(runsDir, tombstone))
    return tombstone
  } finally {
    await releaseLock(finalizeLock, record)
  }
}

async function withFactsRunsLock<T>(locksDir: string, operation: () => Promise<T>): Promise<T> {
  const record = await createLockRecord("facts-runs", { runId: "facts-prune" })
  return withLock(factsRunsLockPath(locksDir), record, operation, { waitTimeoutMs: RUNS_LOCK_WAIT_MS })
}
