// What the next retention pass would remove, counted read-only for `/doctor` (design 6): the same
// classifiers the pass uses, minus the claims. Anchors are approximated by the scanned high water and
// the newest folded run; reservations and lock contention are decided by the pass itself.

import { join } from "node:path"

import { existsSync, lstat } from "../fs/resilient"
import type { MemoryIdentityPaths } from "../identity/layout"
import {
  readReflectionRunIdMark,
  reflectionRunNumber,
  scanReflectionRunHighWater,
} from "../reflection/run-id-high-water"
import { COMPLETIONS_KEEP_NEWEST, readCompletion } from "./completions"
import { classifyJournalEntry } from "./journals"
import { readUnreflectedRetentionGate } from "./reflection-health-signal"
import { DAY_MS, idleSince, listNames, type RuntimeRetentionPolicy } from "./policy"
import { RETENTION_TOMBSTONE_PREFIX, classifyReflectionRun } from "./reflection-runs"
import { KIBITZER_ENCODED_SESSION_PATTERN, kibitzerSidecarsRoot } from "./sidecars"
import { measureTreeBytes } from "./size"

export interface RuntimePastRetention {
  readonly runs: number
  readonly journals: number
  readonly sidecars: number
  /** Journals no retention row classifies (kept, design r2 2.3 `unclassified`). */
  readonly unclassifiedJournals: number
  /** Bytes retention would free for the counted items; present only when `measureBytes` is set (#12959). */
  readonly bytes?: number
}

/** Folded runs the next pass would remove, by its rules (reflection-runs.ts), minus what only the pass decides. */
async function pastRetentionRunNames(input: {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  readonly now: () => number
}): Promise<string[]> {
  const cutoff = input.now() - input.policy.retentionDays * DAY_MS
  const runsDir = join(input.paths.reflection, "runs")
  const highWater = await scanReflectionRunHighWater(input.paths)
  const folded: { name: string; finishedAt: number }[] = []
  for (const name of await listNames(runsDir)) {
    if (name.startsWith(RETENTION_TOMBSTONE_PREFIX)) continue
    const classified = await classifyReflectionRun(join(runsDir, name), name)
    if (typeof classified !== "string") folded.push({ name, finishedAt: classified.finishedAt })
  }
  const newest = folded.toSorted(
    (left, right) => right.finishedAt - left.finishedAt || right.name.localeCompare(left.name),
  )[0]?.name
  const names: string[] = []
  for (const run of folded) {
    if (run.name === newest || reflectionRunNumber(run.name) === highWater || run.finishedAt > cutoff) continue
    if (await idleSince(join(runsDir, run.name), cutoff)) names.push(run.name)
  }
  return names
}

export async function countRuntimePastRetention(input: {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  readonly now: () => number
  readonly isLiveSession?: (sessionId: string) => boolean
  readonly reflectionEnabled?: boolean
  /** The doctors' measurement deadline; once it fires the count rejects with the abort. */
  readonly signal?: AbortSignal
  /** Also sum the bytes of what is counted, for the `--fix --dry-run` size-cap line (#12959). */
  readonly measureBytes?: boolean
}): Promise<RuntimePastRetention> {
  const cutoff = input.now() - input.policy.retentionDays * DAY_MS
  let bytes = 0
  const charge = async (path: string): Promise<void> => {
    if (input.measureBytes === true) bytes += await measureTreeBytes(path, input.signal)
  }
  const runNames = await pastRetentionRunNames(input)
  for (const name of runNames) await charge(join(input.paths.reflection, "runs", name))
  const runs = runNames.length

  let journals = 0
  let unclassifiedJournals = 0
  const context = {
    paths: input.paths,
    policy: input.policy,
    now: input.now,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }
  const gate = await readUnreflectedRetentionGate(input.paths.reflection, input.reflectionEnabled ?? true)
  for (const sessionId of await listNames(input.paths.transcripts)) {
    if (input.isLiveSession?.(sessionId) === true) continue
    // A stray file is skipped and an unreadable journal is kept, as the pass does (#12538 review r3 M1).
    const verdict = await classifyJournalEntry(context, join(input.paths.transcripts, sessionId), gate)
    if (verdict === undefined) continue
    if (typeof verdict !== "string") {
      journals += 1
      await charge(join(input.paths.transcripts, sessionId))
    } else if (verdict === "unclassified") unclassifiedJournals += 1
  }

  let sidecars = 0
  const root = kibitzerSidecarsRoot(input.paths.recall)
  for (const name of await listNames(root)) {
    if (!KIBITZER_ENCODED_SESSION_PATTERN.test(name)) continue
    const stats = await lstat(join(root, name)).catch(() => undefined)
    if (stats?.isDirectory() === true && (await idleSince(join(root, name), cutoff))) {
      sidecars += 1
      await charge(join(root, name))
    }
  }
  return { runs, journals, sidecars, unclassifiedJournals, ...(input.measureBytes === true ? { bytes } : {}) }
}

/**
 * Bytes held by journals never or only partly folded into memory (the input cap tiers 4/5 and J2/J3
 * would discard): whole never-reflected journals, the transcript of partly-reflected ones. Reported by
 * both doctor surfaces when `discard_unreflected_journals` is off and the cap cannot be met.
 */
export async function measureUnreflectedJournalBytes(input: {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  /** The doctors' measurement deadline: each journal reads its whole transcript, so the walk stops once it fires. */
  readonly signal?: AbortSignal
}): Promise<number> {
  // Age does not matter here: every unreflected journal counts, so the classifier's idle window is open.
  const context = {
    paths: input.paths,
    now: () => Number.POSITIVE_INFINITY,
    policy: { ...input.policy, retentionDays: 0, abandonedJournalDays: 0, discardUnreflectedJournals: true },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }
  let bytes = 0
  for (const sessionId of await listNames(input.paths.transcripts)) {
    const dir = join(input.paths.transcripts, sessionId)
    const verdict = await classifyJournalEntry(context, dir)
    if (verdict === undefined) continue
    // A transcript holding rows its state never counted is unreflected input kept in place.
    if (verdict === "state-behind-transcript") bytes += await measureTreeBytes(dir)
    if (typeof verdict === "string") continue
    if (verdict.kind === "never") bytes += await measureTreeBytes(dir)
    else if (verdict.kind === "partly") bytes += await measureTreeBytes(join(dir, "transcript.jsonl"))
  }
  return bytes
}

export interface RuntimePastRetentionOtherStores {
  readonly completions: number
  readonly ledgers: number
  /** Legacy `reflection-sessions` entries, plus one for `recall/runs`. */
  readonly legacy: number
  /** Bytes retention would free for the counted items; present only when `measureBytes` is set (#12959). */
  readonly bytes?: number
}

/**
 * The stores {@link countRuntimePastRetention} leaves out, counted read-only by the pass's own rules
 * (completions.ts, recall-ledgers.ts, legacy.ts) for the `--fix --dry-run` preview. The pass records the
 * scanned high water as `run-id.json` before it removes anything, so the preview reads the mark as at least
 * that high water. Live sessions are unknown here, as they are to the host sweep.
 */
export async function countRuntimePastRetentionOtherStores(input: {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  readonly now: () => number
  readonly signal?: AbortSignal
  /** Also sum the bytes of what is counted, for the `--fix --dry-run` size-cap line (#12959). */
  readonly measureBytes?: boolean
}): Promise<RuntimePastRetentionOtherStores> {
  let bytes = 0
  const charge = async (path: string): Promise<void> => {
    if (input.measureBytes === true) bytes += await measureTreeBytes(path, input.signal)
  }
  const highWater = await scanReflectionRunHighWater(input.paths)
  // The pass removes runs before completions, so a run it removes no longer keeps its completion (`run-present`).
  const removedRuns = new Set(await pastRetentionRunNames(input))
  const mark = Math.max((await readReflectionRunIdMark(input.paths.reflection)) ?? 0, highWater)
  const completionsCutoff = input.now() - input.policy.completionsDays * DAY_MS
  const retentionCutoff = input.now() - input.policy.retentionDays * DAY_MS

  const dir = join(input.paths.reflection, "completions")
  const records: { readonly runId: string; readonly finishedAt: number; readonly consumed: boolean }[] = []
  for (const name of await listNames(dir)) {
    input.signal?.throwIfAborted()
    if (!name.endsWith(".json")) continue
    const record = await readCompletion(join(dir, name), name.slice(0, -".json".length))
    if (record !== undefined) records.push(record)
  }
  const newest = new Set(
    records
      .toSorted((left, right) => right.finishedAt - left.finishedAt || (left.runId < right.runId ? 1 : -1))
      .slice(0, COMPLETIONS_KEEP_NEWEST)
      .map((record) => record.runId),
  )
  let completions = 0
  for (const record of records) {
    const number = reflectionRunNumber(record.runId)
    if (newest.has(record.runId) || !record.consumed || record.finishedAt > completionsCutoff) continue
    if (!removedRuns.has(record.runId) && existsSync(join(input.paths.reflection, "runs", record.runId))) continue
    if (number === 0 || number > mark || number === highWater) continue
    completions += 1
    await charge(join(dir, `${record.runId}.json`))
  }

  let ledgers = 0
  for (const name of await listNames(input.paths.recallLedger)) {
    input.signal?.throwIfAborted()
    if (!name.endsWith(".json")) continue
    const stats = await lstat(join(input.paths.recallLedger, name)).catch(() => undefined)
    if (stats?.isFile() === true && stats.mtimeMs <= completionsCutoff) {
      ledgers += 1
      await charge(join(input.paths.recallLedger, name))
    }
  }

  let legacy = 0
  for (const name of await listNames(input.paths.reflectionSessions)) {
    input.signal?.throwIfAborted()
    if (
      reflectionRunNumber(name) !== highWater &&
      (await idleSince(join(input.paths.reflectionSessions, name), retentionCutoff))
    ) {
      legacy += 1
      await charge(join(input.paths.reflectionSessions, name))
    }
  }
  const recallRuns = join(input.paths.recall, "runs")
  if (existsSync(recallRuns) && (await idleSince(recallRuns, retentionCutoff))) {
    legacy += 1
    await charge(recallRuns)
  }
  return { completions, ledgers, legacy, ...(input.measureBytes === true ? { bytes } : {}) }
}
