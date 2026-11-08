// What the next retention pass would remove, counted read-only for `/doctor` (design 6): the same
// classifiers the pass uses, minus the claims. Anchors are approximated by the scanned high water and
// the newest folded run; reservations and lock contention are decided by the pass itself.

import { join } from "node:path"

import { lstat } from "../fs/resilient"
import type { MemoryIdentityPaths } from "../identity/layout"
import { reflectionRunNumber, scanReflectionRunHighWater } from "../reflection/run-id-high-water"
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
}

export async function countRuntimePastRetention(input: {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  readonly now: () => number
  readonly isLiveSession?: (sessionId: string) => boolean
  readonly reflectionEnabled?: boolean
  /** The doctors' measurement deadline; once it fires the count rejects with the abort. */
  readonly signal?: AbortSignal
}): Promise<RuntimePastRetention> {
  const cutoff = input.now() - input.policy.retentionDays * DAY_MS
  const runsDir = join(input.paths.reflection, "runs")
  const highWater = await scanReflectionRunHighWater(input.paths)
  const folded: { name: string; finishedAt: number }[] = []
  for (const name of await listNames(runsDir)) {
    if (name.startsWith(RETENTION_TOMBSTONE_PREFIX)) continue
    const classified = await classifyReflectionRun(join(runsDir, name), name)
    if (typeof classified !== "string") folded.push({ name, finishedAt: classified.finishedAt })
  }
  const newest = folded.toSorted((left, right) => right.finishedAt - left.finishedAt || right.name.localeCompare(left.name))[0]?.name
  let runs = 0
  for (const run of folded) {
    if (run.name === newest || reflectionRunNumber(run.name) === highWater || run.finishedAt > cutoff) continue
    if (await idleSince(join(runsDir, run.name), cutoff)) runs += 1
  }

  let journals = 0
  let unclassifiedJournals = 0
  const context = { paths: input.paths, policy: input.policy, now: input.now, ...(input.signal === undefined ? {} : { signal: input.signal }) }
  const gate = await readUnreflectedRetentionGate(input.paths.reflection, input.reflectionEnabled ?? true)
  for (const sessionId of await listNames(input.paths.transcripts)) {
    if (input.isLiveSession?.(sessionId) === true) continue
    // A stray file is skipped and an unreadable journal is kept, as the pass does (#12538 review r3 M1).
    const verdict = await classifyJournalEntry(context, join(input.paths.transcripts, sessionId), gate)
    if (verdict === undefined) continue
    if (typeof verdict !== "string") journals += 1
    else if (verdict === "unclassified") unclassifiedJournals += 1
  }

  let sidecars = 0
  const root = kibitzerSidecarsRoot(input.paths.recall)
  for (const name of await listNames(root)) {
    if (!KIBITZER_ENCODED_SESSION_PATTERN.test(name)) continue
    const stats = await lstat(join(root, name)).catch(() => undefined)
    if (stats?.isDirectory() === true && (await idleSince(join(root, name), cutoff))) sidecars += 1
  }
  return { runs, journals, sidecars, unclassifiedJournals }
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
