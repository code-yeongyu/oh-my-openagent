// Per-identity runtime size cap (design 3): after retention, when runtime/ still holds more than
// `max_bytes`, evict oldest-first through six tiers, each exhausted before the next, until it fits.
// Every eviction goes through the retention claim for its store (finalize lock + tombstone for runs,
// the journal lock for journals, the owner lock + tombstone for sidecars), judged by the tier floor
// instead of the retention window, so each store keeps exactly one deletion path. The run-id high water,
// the newest folded run, reservations, live sessions, owned sidecars and contended locks are never
// evicted; completions are not evictable at all. The abort signal is honoured between items.

import { join } from "node:path"

import { lstat } from "../fs/resilient"
import type { MemoryIdentityPaths } from "../identity/layout"
import { withLocalJournalLock, type JournalLock } from "../journal/lock"
import { reflectionRunNumber, scanReflectionRunHighWater } from "../reflection/run-id-high-water"
import { readReflectionRetentionGuard, readReservations, reservedRunIds } from "./guard"
import { readUnreflectedRetentionGate } from "./reflection-health-signal"
import { classifyJournalEntry, removeTranscriptJournalUnderLock } from "./journals"
import { DAY_MS, listNames, newestMtime, type RetentionContext, type RuntimeRetentionPolicy } from "./policy"
import { RETENTION_TOMBSTONE_PREFIX, claimReflectionRun, classifyReflectionRun, removeTombstone } from "./reflection-runs"
import {
  KIBITZER_ENCODED_SESSION_PATTERN,
  KIBITZER_SIDECAR_TOMBSTONE_PREFIX,
  claimKibitzerSidecar,
  kibitzerSidecarOwnerLockPathFor,
  kibitzerSidecarsRoot,
} from "./sidecars"
import { formatRuntimeBytes, measureRuntimeSize, measureTreeBytes } from "./size"

export type RuntimeCapTier =
  | "folded-run"
  | "fully-reflected-transcript"
  | "sidecar"
  | "never-reflected-journal"
  | "partly-reflected-transcript"
  | "unfolded-run"

export type RuntimeCapKeepReason = "reserved" | "reflection-unhealthy" | "unreflected-retention-off" | "high-water" | "newest" | "newest-unfolded" | "reserved" | "locked" | "recent" | "live" | "owned" | "changed-during-removal" | "state-unreadable"

export interface RuntimeSizeCapOptions extends Omit<RetentionContext, "policy"> {
  readonly policy: RuntimeRetentionPolicy
  /** `memory.runtime.max_bytes`; `0` measures only. */
  readonly maxBytes: number
  /** Encoded sidecar directory names this process's live sessions own. */
  readonly ownedSidecars?: ReadonlySet<string>
  readonly journalLock?: JournalLock
  /**
   * Idle floor for the journal tiers 2, 4 and 5. In session it stays at 24 h for tiers 4/5 (tier 2 has
   * none); a caller that cannot see live sessions (the CLI fix pass, the host sweep) passes `retention_days`, so an
   * idle but alive session never loses its journal to it.
   */
  readonly journalFloorMs?: number
  /** `memory.reflection.enabled` for the identity; when false the health gate never closes. */
  readonly reflectionEnabled?: boolean
  /** `pass_budget_ms` left for the cap; charged from the end of the measurement walk, which is not charged. */
  readonly budgetMs?: number
  /** Monotonic timer for the budget; separate from `now`, which dates the stores. */
  readonly clock?: () => number
  /** Deadline of the measurement walk (the pass's budget and abort signal joined); aborting it records `measure-over-budget`. */
  readonly measureSignal?: AbortSignal
  /** Cursor of an interrupted cap pass: that tier's items up to it are skipped. */
  readonly resume?: RuntimeCapCursor
}

/** The cap's own resume point: the `cap` field of the pass's cursor file (`runtime/retention.json`, owned by the pass). */
export interface RuntimeCapCursor {
  readonly store: "cap"
  readonly tier: string
  /** The tier's own ordering clock of the last item walked (finishedAt or newest mtime). */
  readonly clock: number
  readonly lastName: string
}

export interface RuntimeCapEviction {
  readonly tier: RuntimeCapTier
  readonly name: string
  readonly bytes: number
}

export interface RuntimeSizeCapReport {
  readonly maxBytes: number
  readonly beforeBytes: number
  readonly afterBytes: number
  /** Bytes still over the cap after the pass; nonzero means nothing evictable was left. */
  readonly exceededBytes: number
  readonly evicted: readonly RuntimeCapEviction[]
  readonly kept: Readonly<Record<string, RuntimeCapKeepReason>>
  /** `reflection-scheduler-busy` when the lock was contended, so the journal tiers were skipped this pass. */
  readonly skipped: readonly string[]
  /** Set when the health gate suspended tiers 4 and 5: the newest failed completion's `finishedAt`. */
  readonly suspendedSince?: string
  /** Set when the budget ran out before the cap fit; the next pass resumes there. */
  readonly cursor?: RuntimeCapCursor
  /** How long the measurement walk took on `clock`. */
  readonly measureMs: number
  /** Bytes in never/partly-reflected journals tiers 4/5 left in place (switch off or health gate closed). */
  readonly unreflectedHeldBytes: number
}

const RUNTIME_CAP_SIDECAR_FLOOR_MS = 60 * 60 * 1000
const RUNTIME_CAP_JOURNAL_FLOOR_MS = 24 * 60 * 60 * 1000
const RUNTIME_CAP_KEPT_UNFOLDED_RUNS = 10

const CAP_KEEP_REASONS: ReadonlySet<string> = new Set<RuntimeCapKeepReason>(["reserved", "reflection-unhealthy", "unreflected-retention-off", "high-water", "newest", "newest-unfolded", "reserved", "locked", "recent", "live", "owned", "changed-during-removal", "state-unreadable"])

function capOutcome(outcome: string): "removed" | RuntimeCapKeepReason {
  if (outcome === "removed") return "removed"
  return CAP_KEEP_REASONS.has(outcome) ? outcome as RuntimeCapKeepReason : "recent"
}

interface Candidate {
  readonly tier: RuntimeCapTier
  readonly name: string
  readonly at: number
  /** What the eviction frees: the whole entry, or the transcript file for transcript-only tiers. */
  readonly measuredPath: string
  readonly evict: () => Promise<"removed" | RuntimeCapKeepReason>
}

export async function runRuntimeSizeCap(options: RuntimeSizeCapOptions): Promise<RuntimeSizeCapReport> {
  options.signal?.throwIfAborted()
  const clock = options.clock ?? (() => performance.now())
  const kept: Record<string, RuntimeCapKeepReason> = {}
  const evicted: RuntimeCapEviction[] = []
  const skipped: string[] = []
  const gate = { suspendedSince: undefined as string | undefined, heldBytes: 0 }
  await clearTombstones(options)
  const measureStart = clock()
  // The caller's deadline aborts a long walk; the clock check below covers a walk that finished late.
  const budgetSignal = options.measureSignal
  // A resumed pass that walks no new item hands its cursor back, so the resume point survives (#12538 review r3 L2).
  const keptResume = options.resume === undefined ? {} : { cursor: options.resume }
  let beforeBytes: number
  try {
    beforeBytes = (await measureRuntimeSize(options.paths.runtime, budgetSignal === undefined ? {} : { signal: budgetSignal })).bytes
  } catch (error) {
    // A disposed caller is an abort, never a budget stop: the pass must not stamp itself complete.
    options.signal?.throwIfAborted()
    if (budgetSignal?.aborted !== true) throw error
    skipped.push("measure-over-budget")
    return { maxBytes: options.maxBytes, beforeBytes: 0, afterBytes: 0, exceededBytes: 0, evicted, kept, skipped, measureMs: clock() - measureStart, unreflectedHeldBytes: 0, ...keptResume }
  }
  const measureEnd = clock()
  const measureMs = measureEnd - measureStart
  const base = { maxBytes: options.maxBytes, beforeBytes, evicted, kept, skipped, measureMs, unreflectedHeldBytes: 0 }
  const unchanged = () => ({ ...base, afterBytes: beforeBytes, exceededBytes: options.maxBytes > 0 ? Math.max(0, beforeBytes - options.maxBytes) : 0 })
  if (options.budgetMs !== undefined && measureMs > options.budgetMs) {
    skipped.push("measure-over-budget")
    return { ...unchanged(), ...keptResume }
  }
  // Nothing under runtime/ is written unless the identity is over its cap: the guard (which may create
  // locks/ and raise run-id.json) and every claim run only past this point.
  if (options.maxBytes <= 0 || beforeBytes <= options.maxBytes) return unchanged()
  const guard = await readReflectionRetentionGuard({ ...options })
  if (guard === undefined) skipped.push("reflection-scheduler-busy")
  const deadline = options.budgetMs === undefined ? Number.POSITIVE_INFINITY : measureEnd + options.budgetMs
  let bytes = beforeBytes
  let last: Candidate | undefined
  let cursor: RuntimeCapCursor | undefined
  walk: for (const tier of await tiers(options, guard, kept, gate)) {
    for (const candidate of await tier()) {
      if (bytes <= options.maxBytes) break walk
      if (isBeforeCursor(candidate, options.resume)) continue
      options.signal?.throwIfAborted()
      if (clock() >= deadline) {
        cursor = last === undefined ? options.resume : { store: "cap", tier: last.tier, clock: last.at, lastName: last.name }
        break walk
      }
      const size = await measureTreeBytes(candidate.measuredPath)
      const outcome = await candidate.evict()
      last = candidate
      if (outcome === "removed") {
        bytes -= size
        evicted.push({ tier: candidate.tier, name: candidate.name, bytes: size })
      } else {
        kept[candidate.name] = outcome
      }
    }
  }
  const afterBytes = evicted.length === 0 ? beforeBytes : (await measureRuntimeSize(options.paths.runtime)).bytes
  return {
    ...base,
    unreflectedHeldBytes: gate.heldBytes,
    afterBytes,
    exceededBytes: Math.max(0, afterBytes - options.maxBytes),
    ...(gate.suspendedSince === undefined ? {} : { suspendedSince: gate.suspendedSince }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

export interface RuntimeCapEvictableOptions {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  readonly now: () => number
  /** `memory.reflection.enabled` for the identity; when false the health gate never closes. */
  readonly reflectionEnabled?: boolean
  readonly journalFloorMs?: number
  /** The doctors' measurement deadline: once it fires the measure rejects with the abort (#12538 review r3 M2). */
  readonly signal?: AbortSignal
}

/**
 * Bytes the next cap pass could evict now, for the doctors (#12538 review M1): every tier's candidates,
 * from a lock-free read of the run-id high water and the reservations, and nothing is written. The
 * doctors see neither live sessions nor the claims' locks, so this is an upper bound.
 */
export async function measureRuntimeCapEvictableBytes(options: RuntimeCapEvictableOptions): Promise<number> {
  const reservations = await readReservations(options.paths.reflection)
  const guard = {
    highWater: await scanReflectionRunHighWater(options.paths),
    reserved: reservations.runIds,
    reservedConversationIds: reservations.conversationIds,
  }
  let bytes = 0
  for (const tier of await tiers({ ...options, maxBytes: 0 }, guard, {}, { suspendedSince: undefined, heldBytes: 0 })) {
    for (const candidate of await tier()) {
      options.signal?.throwIfAborted()
      bytes += await measureTreeBytes(candidate.measuredPath)
    }
  }
  return bytes
}

export interface RuntimeCapExcess {
  /** Bytes over `max_bytes`; nothing is described at or under the cap. */
  readonly overCapBytes: number
  /** {@link measureRuntimeCapEvictableBytes}. */
  readonly evictableBytes: number
  /** Bytes in never/partly-reflected journals. */
  readonly unreflectedBytes: number
  readonly discardUnreflectedJournals: boolean
}

/**
 * The over-cap line both doctors print (`/doctor` and `omo doctor`). "Nothing evictable; held by
 * unreflected journals" is said only when no tier has anything to evict and the unreflected journals
 * the switch keeps are enough to hold the excess; otherwise the line says what the next pass evicts.
 */
export function describeRuntimeCapExcess(input: RuntimeCapExcess): string | undefined {
  if (input.overCapBytes <= 0) return undefined
  const over = `cap exceeded by ${formatRuntimeBytes(input.overCapBytes)}`
  const held = !input.discardUnreflectedJournals && input.unreflectedBytes > 0
    ? `held by unreflected journals: ${formatRuntimeBytes(input.unreflectedBytes)} (discard_unreflected_journals off)`
    : undefined
  if (input.evictableBytes >= input.overCapBytes) {
    return `${over}; the next maintenance pass evicts it (${formatRuntimeBytes(input.evictableBytes)} evictable)`
  }
  if (input.evictableBytes > 0) {
    return `${over}; the next maintenance pass evicts up to ${formatRuntimeBytes(input.evictableBytes)} of it${held === undefined ? "" : `; ${held}`}`
  }
  if (held !== undefined && input.overCapBytes <= input.unreflectedBytes) return `${over}, nothing evictable; ${held}`
  return `${over}, nothing evictable: live sessions, reserved runs and the newest runs are never evicted${held === undefined ? "" : `; ${held}`}`
}

function isBeforeCursor(candidate: Candidate, cursor: RuntimeCapCursor | undefined): boolean {
  if (cursor === undefined || candidate.tier !== cursor.tier) return false
  return candidate.at < cursor.clock || (candidate.at === cursor.clock && candidate.name.localeCompare(cursor.lastName) <= 0)
}

async function clearTombstones(options: RuntimeSizeCapOptions): Promise<void> {
  const runsDir = join(options.paths.reflection, "runs")
  for (const name of await listNames(runsDir)) {
    if (name.startsWith(RETENTION_TOMBSTONE_PREFIX)) await removeTombstone(join(runsDir, name), options)
  }
  const sidecarsDir = kibitzerSidecarsRoot(options.paths.recall)
  for (const name of await listNames(sidecarsDir)) {
    if (name.startsWith(KIBITZER_SIDECAR_TOMBSTONE_PREFIX)) await removeTombstone(join(sidecarsDir, name), options)
  }
}

type Guard = Awaited<ReturnType<typeof readReflectionRetentionGuard>>
type TierSource = () => Promise<readonly Candidate[]>

async function tiers(
  options: RuntimeSizeCapOptions,
  guard: Guard,
  kept: Record<string, RuntimeCapKeepReason>,
  gate: { suspendedSince: string | undefined; heldBytes: number },
): Promise<TierSource[]> {
  // A contended scheduler lock means a reservation is being made: its journals are unknown, so the
  // journal tiers wait for the next pass (B15). The run tiers still run on a lock-free read, because
  // every run claim re-reads the reservations under the run's finalize lock and the high water only
  // ever grows past the oldest candidates.
  const runGuard = guard ?? {
    highWater: await scanReflectionRunHighWater(options.paths),
    reserved: await reservedRunIds(options.paths.reflection),
    reservedConversationIds: new Set<string>(),
  }
  const runs = await runCandidates(options, runGuard, kept)
  // Journals are classified only when the walk reaches their first tier, so a pass that fits on tier 1
  // reads no transcript (#12538 review r3 L1).
  let journalScan: ReturnType<typeof journalCandidates> | undefined
  const journals = async () => guard === undefined ? undefined : await (journalScan ??= journalCandidates(options, guard.reservedConversationIds, kept))
  const unfolded = async (entries: readonly Candidate[]): Promise<readonly Candidate[]> => {
    if (entries.length === 0) return entries
    const hold = async (reason: RuntimeCapKeepReason): Promise<readonly Candidate[]> => {
      for (const entry of entries) {
        kept[entry.name] = reason
        gate.heldBytes += await measureTreeBytes(entry.measuredPath)
      }
      return []
    }
    // `discard_unreflected_journals` (default off) gates every rule that deletes unreflected input.
    if (options.policy.discardUnreflectedJournals !== true) return hold("unreflected-retention-off")
    const health = await readUnreflectedRetentionGate(options.paths.reflection, options.reflectionEnabled ?? true)
    // No admit callback is passed, so the gate is always read; an unread gate would count as closed.
    if (health === undefined) return hold("reflection-unhealthy")
    if (health.open) return entries
    if (health.newest !== undefined) gate.suspendedSince = health.newest.at
    return hold("reflection-unhealthy")
  }
  return [
    async () => runs.folded,
    async () => (await journals())?.fully ?? [],
    () => sidecarCandidates(options, kept),
    async () => unfolded((await journals())?.never ?? []),
    async () => unfolded((await journals())?.partly ?? []),
    async () => runs.unfolded,
  ]
}

async function runCandidates(
  options: RuntimeSizeCapOptions,
  guard: NonNullable<Guard>,
  kept: Record<string, RuntimeCapKeepReason>,
): Promise<{ readonly folded: Candidate[]; readonly unfolded: Candidate[] }> {
  const runsDir = join(options.paths.reflection, "runs")
  const context: RetentionContext = { ...options }
  const folded: { name: string; at: number }[] = []
  const unfolded: { name: string; at: number }[] = []
  for (const name of await listNames(runsDir)) {
    if (name.startsWith(RETENTION_TOMBSTONE_PREFIX)) continue
    const classified = await classifyReflectionRun(join(runsDir, name), name)
    if (typeof classified !== "string") folded.push({ name, at: classified.finishedAt })
    else if (classified === "unfolded-terminal") unfolded.push({ name, at: (await newestMtime(join(runsDir, name))) ?? 0 })
  }
  const byAge = (left: { name: string; at: number }, right: { name: string; at: number }) =>
    left.at - right.at || left.name.localeCompare(right.name)
  folded.sort(byAge)
  unfolded.sort(byAge)
  const exempt = (name: string): RuntimeCapKeepReason | undefined => {
    if (reflectionRunNumber(name) === guard.highWater) return "high-water"
    if (guard.reserved.has(name)) return "reserved"
    return undefined
  }
  const newestFolded = folded.at(-1)?.name
  const foldedCandidates: Candidate[] = []
  for (const run of folded) {
    const reason = exempt(run.name) ?? (run.name === newestFolded ? "newest" : undefined)
    if (reason !== undefined) {
      kept[run.name] = reason
      continue
    }
    foldedCandidates.push({
      tier: "folded-run",
      name: run.name,
      at: run.at,
      measuredPath: join(runsDir, run.name),
      evict: async () => capOutcome(await claimReflectionRun(context, runsDir, run.name, Number.POSITIVE_INFINITY)),
    })
  }
  const retentionCutoff = options.now() - options.policy.retentionDays * DAY_MS
  const keptUnfolded = new Set(unfolded.slice(-RUNTIME_CAP_KEPT_UNFOLDED_RUNS).map((run) => run.name))
  const unfoldedCandidates: Candidate[] = []
  for (const run of unfolded) {
    const reason = exempt(run.name)
      ?? (keptUnfolded.has(run.name) ? "newest-unfolded" : undefined)
      ?? (run.at > retentionCutoff ? "recent" : undefined)
    if (reason !== undefined) {
      kept[run.name] = reason
      continue
    }
    unfoldedCandidates.push({
      tier: "unfolded-run",
      name: run.name,
      at: run.at,
      measuredPath: join(runsDir, run.name),
      evict: async () => capOutcome(await claimReflectionRun(context, runsDir, run.name, retentionCutoff)),
    })
  }
  return { folded: foldedCandidates, unfolded: unfoldedCandidates }
}

async function journalCandidates(
  options: RuntimeSizeCapOptions,
  reserved: ReadonlySet<string>,
  kept: Record<string, RuntimeCapKeepReason>,
): Promise<{ readonly fully: Candidate[]; readonly never: Candidate[]; readonly partly: Candidate[] }> {
  // The tier floors stand in for the retention windows: fully reflected at any age, the rest idle 24 h,
  // unless the caller raised every journal floor (journalFloorMs).
  const floorDays = (options.journalFloorMs ?? RUNTIME_CAP_JOURNAL_FLOOR_MS) / DAY_MS
  const context: RetentionContext = {
    ...options,
    policy: { ...options.policy, retentionDays: options.journalFloorMs === undefined ? 0 : floorDays, abandonedJournalDays: floorDays },
  }
  const lock = options.journalLock ?? withLocalJournalLock
  // Classes come from an open gate with the switch on; the switch and the health gate are applied per
  // tier below (with the held bytes reported), and the locked claim re-checks the real gate.
  const classifyContext: RetentionContext = { ...context, policy: { ...context.policy, discardUnreflectedJournals: true } }
  const realGate = await readUnreflectedRetentionGate(options.paths.reflection, options.reflectionEnabled ?? true)
  const found = { fully: [] as { name: string; at: number }[], never: [] as { name: string; at: number }[], partly: [] as { name: string; at: number }[] }
  for (const sessionId of await listNames(options.paths.transcripts)) {
    const dir = join(options.paths.transcripts, sessionId)
    if (options.isLiveSession?.(sessionId) === true) {
      kept[sessionId] = "live"
      continue
    }
    if (reserved.has(sessionId)) {
      kept[sessionId] = "reserved"
      continue
    }
    const verdict = await classifyJournalEntry(classifyContext, dir)
    if (verdict === "state-unreadable") kept[sessionId] = "state-unreadable"
    if (verdict === undefined || typeof verdict === "string") continue
    found[verdict.kind].push({ name: sessionId, at: (await newestMtime(dir)) ?? 0 })
  }
  const toCandidates = (entries: { name: string; at: number }[], tier: RuntimeCapTier, transcriptOnly: boolean): Candidate[] =>
    entries
      .sort((left, right) => left.at - right.at || left.name.localeCompare(right.name))
      .map((entry) => {
        const dir = join(options.paths.transcripts, entry.name)
        return {
          tier,
          name: entry.name,
          at: entry.at,
          measuredPath: transcriptOnly ? join(dir, "transcript.jsonl") : dir,
          // A journal that turns unreadable between its classification and the locked eviction is kept
          // with that reason, as the pass's own visit keeps it (#12538 review r4 L); an abort propagates.
          evict: async () => capOutcome(await removeTranscriptJournalUnderLock(context, dir, lock, realGate).catch((error: unknown): RuntimeCapKeepReason => {
            if (options.signal?.aborted === true) throw error
            return "state-unreadable"
          })),
        }
      })
  return {
    fully: toCandidates(found.fully, "fully-reflected-transcript", true),
    never: toCandidates(found.never, "never-reflected-journal", false),
    partly: toCandidates(found.partly, "partly-reflected-transcript", true),
  }
}

async function sidecarCandidates(options: RuntimeSizeCapOptions, kept: Record<string, RuntimeCapKeepReason>): Promise<Candidate[]> {
  const root = kibitzerSidecarsRoot(options.paths.recall)
  const entries: { name: string; at: number }[] = []
  for (const name of await listNames(root)) {
    if (name.startsWith(KIBITZER_SIDECAR_TOMBSTONE_PREFIX) || !KIBITZER_ENCODED_SESSION_PATTERN.test(name)) continue
    if (options.ownedSidecars?.has(name) === true) {
      kept[name] = "owned"
      continue
    }
    const path = join(root, name)
    const stats = await lstat(path).catch(() => undefined)
    if (stats === undefined || !stats.isDirectory()) continue
    const at = (await newestMtime(path)) ?? 0
    if (options.now() - at < RUNTIME_CAP_SIDECAR_FLOOR_MS) {
      kept[name] = "recent"
      continue
    }
    entries.push({ name, at })
  }
  entries.sort((left, right) => left.at - right.at || left.name.localeCompare(right.name))
  return entries.map((entry) => ({
    tier: "sidecar",
    name: entry.name,
    at: entry.at,
    measuredPath: join(root, entry.name),
    evict: async () => capOutcome(await claimKibitzerSidecar(
      join(root, entry.name),
      kibitzerSidecarOwnerLockPathFor(options.paths.locks, entry.name),
      options.now(),
      RUNTIME_CAP_SIDECAR_FLOOR_MS,
      { recallDir: options.paths.recall, locksDir: options.paths.locks, ...(options.warn === undefined ? {} : { warn: options.warn }) },
    )),
  }))
}
