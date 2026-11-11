// Folded reflection run directories (`reflection/runs/<runId>/`, design 2.1). A run is removed only
// when its final.json names it, its outcome is in the repo (`merged` / `no_changes`), it finished
// and was last touched more than `retentionDays` ago, it is neither reserved nor an anchor (the
// run-id high water, the newest folded run), and its finalize lock is free. The claim is a rename
// to a `.prune-` tombstone under that lock; the delete runs after release through removeTree.

import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { existsSync, readFile, rename } from "../fs/resilient"
import { removeTree } from "../fs/remove-tree"
import { LockContentionError, acquireLock, createLockRecord, releaseLock, runFinalizationLockPath } from "../locks"
import { reflectionRunNumber } from "../reflection/run-id-high-water"
import { reservedRunIds, type LazyRetentionGuard } from "./guard"
import { DAY_MS, StoreTally, describeError, errorCode, idleSince, listNames, type RetentionContext, type RetentionStoreResult } from "./policy"

export const RETENTION_TOMBSTONE_PREFIX = ".prune-"
const FOLDED_OUTCOMES = new Set(["merged", "no_changes"])
const TERMINAL_SENTINELS = ["abandoned.json", "quarantined.json"] as const

type Folded = { readonly name: string; readonly finishedAt: number }

export async function pruneReflectionRuns(context: RetentionContext, lazyGuard: LazyRetentionGuard): Promise<RetentionStoreResult> {
  const runsDir = join(context.paths.reflection, "runs")
  const tally = new StoreTally()
  const folded: Folded[] = []
  const crashTombstones: string[] = []
  for (const name of await listNames(runsDir)) {
    // Classifying reads metadata only: it stops on the abort signal, never on the time budget.
    if (context.budget?.proceed("runs") === false) return tally.result()
    const runDir = join(runsDir, name)
    if (name.startsWith(RETENTION_TOMBSTONE_PREFIX)) {
      crashTombstones.push(runDir)
      continue
    }
    const classified = await classify(runDir, name)
    if (typeof classified === "string") tally.keep(name, classified)
    else folded.push(classified)
  }
  // Removing a crash tombstone is removal work, so each one is admitted against the pass budget.
  for (const runDir of crashTombstones) {
    if (context.budget?.admit("runs") === false) return tally.result()
    await removeTombstone(runDir, context)
  }
  const newest = folded.reduce<Folded | undefined>((best, run) =>
    best === undefined || run.finishedAt > best.finishedAt || (run.finishedAt === best.finishedAt && run.name > best.name) ? run : best, undefined)
  const cutoff = context.now() - context.policy.retentionDays * DAY_MS
  for (const run of folded) {
    if (context.budget?.skip("runs", run.name) === true) continue
    if (context.budget?.admit("runs") === false) break
    const guard = run.name === newest?.name || run.finishedAt > cutoff || !(await idleSince(join(runsDir, run.name), cutoff))
      ? undefined
      : await lazyGuard.get()
    if (run.name === newest?.name) tally.keep(run.name, "anchor")
    else if (run.finishedAt > cutoff || !(await idleSince(join(runsDir, run.name), cutoff))) tally.keep(run.name, "recent")
    else if (guard === undefined) tally.keep(run.name, "scheduler-busy")
    else if (guard.reserved.has(run.name)) tally.keep(run.name, "reserved")
    else if (reflectionRunNumber(run.name) === guard.highWater) tally.keep(run.name, "anchor")
    else {
      const outcome = await claimAndRemove(context, runsDir, run.name, cutoff)
      if (outcome === "removed") tally.removed.push(run.name)
      else tally.keep(run.name, outcome)
    }
    context.budget?.done("runs", run.name)
  }
  return tally.result()
}

async function classify(runDir: string, name: string): Promise<Folded | "malformed" | "unfolded-terminal" | "no-terminal"> {
  let raw: string
  try {
    raw = await readFile(join(runDir, "final.json"), "utf8")
  } catch (error) {
    if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTDIR") return "malformed"
    return TERMINAL_SENTINELS.some((file) => existsSync(join(runDir, file))) ? "unfolded-terminal" : "no-terminal"
  }
  let final: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "malformed"
    final = parsed as Record<string, unknown>
  } catch {
    return "malformed"
  }
  const finishedAt = typeof final.finishedAt === "string" ? Date.parse(final.finishedAt) : Number.NaN
  if (final.runId !== name || Number.isNaN(finishedAt) || typeof final.outcome !== "string") return "malformed"
  return FOLDED_OUTCOMES.has(final.outcome) ? { name, finishedAt } : "unfolded-terminal"
}

async function claimAndRemove(
  context: RetentionContext,
  runsDir: string,
  name: string,
  cutoff: number,
): Promise<"removed" | "locked" | "reserved" | "recent" | "claim-failed"> {
  const lockPath = runFinalizationLockPath(context.paths.locks, name)
  const record = await createLockRecord("runtime-retention", { runId: name })
  try {
    await acquireLock(lockPath, record, { waitTimeoutMs: 0 })
  } catch (error) {
    if (error instanceof LockContentionError) return "locked"
    throw error
  }
  let tombstone: string
  try {
    // A reservation that took this id between the guard and the lock keeps it.
    if ((await reservedRunIds(context.paths.reflection)).has(name)) return "reserved"
    if (!(await idleSince(join(runsDir, name), cutoff))) return "recent"
    tombstone = join(runsDir, `${RETENTION_TOMBSTONE_PREFIX}${name}-${randomUUID()}`)
    try {
      await context.beforeClaimRename?.(join(runsDir, name), tombstone)
      await rename(join(runsDir, name), tombstone)
    } catch (error) {
      context.warn?.("memory runtime retention could not claim a run directory", { runId: name, error: describeError(error) })
      return "claim-failed"
    }
  } finally {
    await releaseLock(lockPath, record)
  }
  // The live name is already gone; a tombstone whose delete fails is retried by the next pass.
  await context.beforeTombstoneDelete?.(tombstone)
  await removeTombstone(tombstone, context)
  return "removed"
}

/** A tombstone is unreachable by name; a failed delete is retried by the next pass. */
export async function removeTombstone(path: string, context: Pick<RetentionContext, "warn">): Promise<boolean> {
  try {
    await removeTree(path)
    return true
  } catch (error) {
    context.warn?.("memory runtime retention could not delete a tombstone", { path, error: describeError(error) })
    return false
  }
}

/** The cap (cap.ts) evicts through the same classification and claim, judged by its tier floor. */
export { classify as classifyReflectionRun, claimAndRemove as claimReflectionRun }
