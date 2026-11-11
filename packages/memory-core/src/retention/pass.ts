// One retention pass over an identity's runtime (design 2, section 6). The reflection stores and the
// journal rules run only when the reservation guard could be read (it also records the run-id mark
// first). The walk is bounded by `passBudgetMs` and by the abort signal, checked between items: a
// pass that stops early persists a resume cursor in `runtime/retention.json` and the next pass
// continues there; a pass that completes deletes the cursor. The size cap keeps its own resume point
// in the same file, which only the cap reads: every pass walks the stores whatever the cap left.

import { PassBudget, type RetentionCursor } from "./budget"
import { runRuntimeSizeCap, type RuntimeCapCursor, type RuntimeSizeCapReport } from "./cap"
import { pruneCompletions } from "./completions"
import { LazyRetentionGuard } from "./guard"
import { pruneTranscriptJournals } from "./journals"
import { pruneLegacyRecallRuns, pruneLegacyReflectionSessions, type LegacyRecallRunsOutcome } from "./legacy"
import { appendRetentionLog } from "./log"
import { DAY_MS, describeError, type RetentionContext, type RetentionStoreResult } from "./policy"
import { pruneRecallLedgers } from "./recall-ledgers"
import { pruneReflectionRuns } from "./reflection-runs"
import { readUnreflectedRetentionGate, type UnreflectedRetentionGate } from "./reflection-health-signal"
import { pruneKibitzerSidecars } from "./sidecars"
import { clearRetentionCursor, readRetentionResumePoints, writeRetentionResumePoints } from "./stamp"

export interface RuntimeRetentionOptions extends Omit<RetentionContext, "budget"> {
  /** Encoded sidecar directory names this process's live sessions own. */
  readonly ownedSidecars?: ReadonlySet<string>
  /** `memory.runtime.max_bytes`: when set, the size cap (design 3) runs after retention; `0` measures only. */
  readonly maxBytes?: number
  /**
   * The cap's journal floor for a caller that cannot see live sessions (the host sweep, `omo doctor
   * --fix`): `retention_days`, so an idle but alive session keeps its journal. Unset keeps the 24 h floor.
   */
  readonly journalFloorMs?: number
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
  /** Read only when `discardUnreflectedJournals` is on; undefined when off or when the pass stopped while reading it. */
  readonly unreflectedGate?: UnreflectedRetentionGate
  /** Set when the pass stopped early (budget or abort), the store walk's or else the cap's; persisted for the next pass. */
  readonly cursor?: RetentionCursor | RuntimeCapCursor
  /** Present when `maxBytes` was set and retention finished inside the budget. */
  readonly cap?: RuntimeSizeCapReport
}

const EMPTY: RetentionStoreResult = { removed: [], kept: {} }

export async function runRuntimeRetention(options: RuntimeRetentionOptions): Promise<RuntimeRetentionReport> {
  options.signal?.throwIfAborted()
  const stored = await readRetentionResumePoints(options.paths.runtime)
  const budget = new PassBudget(options.now, options.policy.passBudgetMs, options.signal, stored.cursor)
  const context: RetentionContext = { ...options, budget }
  const guard = new LazyRetentionGuard(context)
  const runs = await pruneReflectionRuns(context, guard)
  const completions = await pruneCompletions(context, guard)
  const reflectionSessions = await pruneLegacyReflectionSessions(context, guard)
  const unreflectedGate = options.policy.discardUnreflectedJournals
    ? await readUnreflectedRetentionGate(options.paths.reflection, options.reflectionEnabled ?? true, () =>
        budget.proceed("journals"),
      )
    : undefined
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
  // The cap (design 3) runs last, inside what is left of the same budget, and resumes its own tier walk
  // from its own resume point, which the store walk never reads (#12538 review r4 M). A pass that stops
  // before the cap keeps that resume point; a pass without a cap drops it.
  let capResume = options.maxBytes === undefined ? undefined : stored.cap
  let cap: RuntimeSizeCapReport | undefined
  if (options.maxBytes !== undefined && budget.stopped === undefined) {
    cap = await runRuntimeSizeCap({
      ...options,
      maxBytes: options.maxBytes,
      budgetMs: budget.remainingMs(),
      measureSignal:
        options.signal === undefined
          ? AbortSignal.timeout(budget.remainingMs())
          : AbortSignal.any([options.signal, AbortSignal.timeout(budget.remainingMs())]),
      ...(capResume === undefined ? {} : { resume: capResume }),
    })
    capResume = cap.cursor
  }
  await logRemovals(options, {
    runs,
    completions,
    reflectionSessions,
    journals,
    sidecars: sidecarResult.pruned,
    ledgers,
    recallRuns,
    cap,
  })
  // A cap that could not even measure hands its resume point back unchanged; marked stalled, it waits
  // for the next interval instead of re-running retention at every bind (#12538 review r5 L1).
  const capStalled = cap?.skipped.includes("measure-over-budget") === true
  if (budget.stopped !== undefined || capResume !== undefined) {
    await writeRetentionResumePoints(options.paths.runtime, {
      ...(budget.stopped === undefined ? {} : { cursor: budget.stopped }),
      ...(capResume === undefined ? {} : { cap: capResume, ...(capStalled ? { capStalled: true as const } : {}) }),
    })
    if (budget.aborted) options.signal?.throwIfAborted()
  } else if (stored.cursor !== undefined || stored.cap !== undefined) {
    await clearRetentionCursor(options.paths.runtime)
  }
  const cursor = budget.stopped ?? cap?.cursor
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
    ...(unreflectedGate === undefined ? {} : { unreflectedGate }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(cap === undefined ? {} : { cap }),
  }
}

async function logRemovals(
  options: RuntimeRetentionOptions,
  stores: {
    readonly runs: RetentionStoreResult
    readonly completions: RetentionStoreResult
    readonly reflectionSessions: RetentionStoreResult
    readonly journals: RetentionStoreResult
    readonly sidecars: readonly string[]
    readonly ledgers: RetentionStoreResult
    readonly recallRuns: LegacyRecallRunsOutcome
    readonly cap: RuntimeSizeCapReport | undefined
  },
): Promise<void> {
  const removed: Record<string, string[]> = {
    runs: [...stores.runs.removed],
    completions: [...stores.completions.removed],
    reflectionSessions: [...stores.reflectionSessions.removed],
    journals: [...stores.journals.removed],
    sidecars: [...stores.sidecars].sort(),
    ledgers: [...stores.ledgers.removed],
    ...(stores.recallRuns === "removed" ? { legacy: ["recall/runs"] } : {}),
  }
  for (const eviction of stores.cap?.evicted ?? []) (removed[`cap:${eviction.tier}`] ??= []).push(eviction.name)
  const capEvictedBytes = stores.cap?.evicted.reduce((total, entry) => total + entry.bytes, 0)
  try {
    await appendRetentionLog(options.paths.runtime, {
      at: options.now(),
      removed,
      ...(capEvictedBytes === undefined ? {} : { capEvictedBytes }),
    })
  } catch (error) {
    // The removals already happened; a log that cannot be written must not fail the pass.
    options.warn?.("memory runtime retention could not write its removal log", { error: describeError(error) })
  }
}

/** Bytes-free summary for one log line: removed counts per store. */
export function summarizeRuntimeRetention(report: RuntimeRetentionReport): {
  readonly removed: number
  readonly [store: string]: number | string | readonly string[]
} {
  const stores = [
    report.runs,
    report.completions,
    report.reflectionSessions,
    report.journals,
    report.sidecars,
    report.ledgers,
  ]
  return {
    removed:
      stores.reduce((total, store) => total + store.removed.length, 0) +
      (report.recallRuns === "removed" ? 1 : 0) +
      (report.cap?.evicted.length ?? 0),
    runs: report.runs.removed.length,
    completions: report.completions.removed.length,
    reflectionSessions: report.reflectionSessions.removed.length,
    journals: report.journals.removed.length,
    sidecars: report.sidecars.removed.length,
    ledgers: report.ledgers.removed.length,
    recallRuns: report.recallRuns,
    skipped: report.skipped,
    ...(report.cursor === undefined ? {} : { interruptedAt: report.cursor.store }),
    ...(report.cap === undefined
      ? {}
      : {
          capBytes: report.cap.maxBytes,
          bytesBefore: report.cap.beforeBytes,
          bytesAfter: report.cap.afterBytes,
          evicted: report.cap.evicted.length,
          evictedBytes: report.cap.evicted.reduce((total, entry) => total + entry.bytes, 0),
          overCapBytes: report.cap.exceededBytes,
          capKeptHighWater: Object.entries(report.cap.kept)
            .filter(([, reason]) => reason === "high-water")
            .map(([name]) => name),
        }),
  }
}
