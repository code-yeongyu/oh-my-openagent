// One retention pass over an identity's runtime (design 2, section 6). The reflection stores and the
// journal rules run only when the reservation guard could be read (it also records the run-id mark
// first). The walk is bounded by `passBudgetMs` and by the abort signal, checked between items: a
// pass that stops early persists a resume cursor in `runtime/retention.json` and the next pass
// continues there; a pass that completes deletes the cursor.

import { PassBudget, type RetentionCursor } from "./budget"
import { pruneCompletions } from "./completions"
import { LazyRetentionGuard } from "./guard"
import { pruneTranscriptJournals } from "./journals"
import { pruneLegacyRecallRuns, pruneLegacyReflectionSessions, type LegacyRecallRunsOutcome } from "./legacy"
import { DAY_MS, type RetentionContext, type RetentionStoreResult } from "./policy"
import { pruneRecallLedgers } from "./recall-ledgers"
import { pruneReflectionRuns } from "./reflection-runs"
import { readUnreflectedRetentionGate, type UnreflectedRetentionGate } from "./reflection-health-signal"
import { pruneKibitzerSidecars } from "./sidecars"
import { clearRetentionCursor, readRetentionCursor, writeRetentionCursor } from "./stamp"

export interface RuntimeRetentionOptions extends Omit<RetentionContext, "budget"> {
  /** Encoded sidecar directory names this process's live sessions own. */
  readonly ownedSidecars?: ReadonlySet<string>
}

export interface RuntimeRetentionReport {
  /** Undefined when the reflection-scheduler lock was busy and the reflection stores were skipped. */
  readonly highWater?: number
  readonly skipped: readonly string[]
  readonly runs: RetentionStoreResult
  readonly completions: RetentionStoreResult
  readonly reflectionSessions: RetentionStoreResult
  readonly journals: RetentionStoreResult
  readonly sidecars: RetentionStoreResult
  readonly ledgers: RetentionStoreResult
  readonly recallRuns: LegacyRecallRunsOutcome
  readonly unreflectedGate: UnreflectedRetentionGate
  /** Set when the pass stopped early (budget or abort); persisted for the next pass. */
  readonly cursor?: RetentionCursor
}

const EMPTY: RetentionStoreResult = { removed: [], kept: {} }

export async function runRuntimeRetention(options: RuntimeRetentionOptions): Promise<RuntimeRetentionReport> {
  options.signal?.throwIfAborted()
  const resume = await readRetentionCursor(options.paths.runtime)
  const budget = new PassBudget(options.now, options.policy.passBudgetMs, options.signal, resume)
  const context: RetentionContext = { ...options, budget }
  const guard = new LazyRetentionGuard(context)
  const runs = await pruneReflectionRuns(context, guard)
  const completions = await pruneCompletions(context, guard)
  const reflectionSessions = await pruneLegacyReflectionSessions(context, guard)
  const unreflectedGate = await readUnreflectedRetentionGate(options.paths.reflection, options.reflectionEnabled ?? true)
  const journals = await pruneTranscriptJournals(context, guard, unreflectedGate)
  const sidecarResult = await pruneKibitzerSidecars({
    recallDir: options.paths.recall,
    locksDir: options.paths.locks,
    now: options.now,
    maxAgeMs: options.policy.retentionDays * DAY_MS,
    skip: (name) => budget.skip("sidecars", name),
    admit: () => budget.admit("sidecars"),
    done: (name) => budget.done("sidecars", name),
    ...(options.ownedSidecars === undefined ? {} : { owned: options.ownedSidecars }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
    ...(options.beforeClaimRename === undefined ? {} : { beforeClaimRename: options.beforeClaimRename }),
    ...(options.beforeTombstoneDelete === undefined ? {} : { beforeTombstoneDelete: options.beforeTombstoneDelete }),
  })
  const ledgers = await pruneRecallLedgers(context)
  const recallRuns = await pruneLegacyRecallRuns(context)
  if (budget.stopped !== undefined) {
    await writeRetentionCursor(options.paths.runtime, budget.stopped)
    if (budget.aborted) options.signal?.throwIfAborted()
  } else if (resume !== undefined) {
    await clearRetentionCursor(options.paths.runtime)
  }
  return {
    ...(guard.value === undefined ? {} : { highWater: guard.value.highWater }),
    skipped: guard.busy ? ["reflection-scheduler-busy"] : [],
    runs,
    completions,
    reflectionSessions,
    journals,
    sidecars: { removed: [...sidecarResult.pruned].sort(), kept: sidecarResult.keptReasons },
    ledgers,
    recallRuns,
    unreflectedGate,
    ...(budget.stopped === undefined ? {} : { cursor: budget.stopped }),
  }
}

/** Bytes-free summary for one log line: removed counts per store. */
export function summarizeRuntimeRetention(report: RuntimeRetentionReport): {
  readonly removed: number
  readonly [store: string]: number | string | readonly string[]
} {
  const stores = [report.runs, report.completions, report.reflectionSessions, report.journals, report.sidecars, report.ledgers]
  return {
    removed: stores.reduce((total, store) => total + store.removed.length, 0) + (report.recallRuns === "removed" ? 1 : 0),
    runs: report.runs.removed.length,
    completions: report.completions.removed.length,
    reflectionSessions: report.reflectionSessions.removed.length,
    journals: report.journals.removed.length,
    sidecars: report.sidecars.removed.length,
    ledgers: report.ledgers.removed.length,
    recallRuns: report.recallRuns,
    skipped: report.skipped,
    ...(report.cursor === undefined ? {} : { interruptedAt: report.cursor.store }),
  }
}
