// Transcript journals (`transcripts/<sessionId>/`, design 2.3), classified from state.json:
// - fully reflected (J1): `transcript.jsonl` goes after `retentionDays` idle and state.json is
//   stamped `transcript_pruned_at`, so a resumed session rebuilds it against the kept anchor;
// - never reflected / no steps (J2): the whole journal goes after `abandonedJournalDays` idle;
//   a resumed session recreates it with the same initial cursor it had;
// - partly reflected (J3): `transcript.jsonl` goes after `abandonedJournalDays`, stamped like J1.
// Every class is judged from state.json, so a transcript that holds rows the state never counted (a
// refused state rename, a crash between the append and the rename) is kept as state-behind-transcript.
// The scan is lock-free; every predicate is re-checked under the journal's own lock, files are
// unlinked under it, and the directory itself is removed only after release (never recursively).

import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { existsSync, lstat, readFile, rename, rm, rmdir, unlink, writeFile } from "../fs/resilient"
import { deriveState, initialReflectionState } from "../journal/cursor"
import { JournalLockTimeoutError, withLocalJournalLock, type JournalLock } from "../journal/lock"
import { TranscriptJournal } from "../journal/store"
import type { LazyRetentionGuard } from "./guard"
import type { UnreflectedRetentionGate } from "./reflection-health-signal"
import { DAY_MS, StoreTally, errorCode, listNames, type RetentionContext, type RetentionKeepReason, type RetentionStoreResult } from "./policy"

const TRANSCRIPT = "transcript.jsonl"
const STATE = "state.json"
const LOCK = "state.lock"

type JournalClass = "fully" | "never" | "partly"
type Verdict = { readonly kind: JournalClass } | RetentionKeepReason

export async function pruneTranscriptJournals(
  context: RetentionContext,
  lazyGuard: LazyRetentionGuard,
  gate: UnreflectedRetentionGate | undefined,
  lock: JournalLock = withLocalJournalLock,
): Promise<RetentionStoreResult> {
  const tally = new StoreTally()
  for (const sessionId of await listNames(context.paths.transcripts)) {
    if (context.budget?.skip("journals", sessionId) === true) continue
    if (context.budget?.admit("journals") === false) break
    // One journal that cannot be read is kept with its reason; it never stops the rest of the pass.
    const outcome = await visitJournal(context, lazyGuard, gate, lock, sessionId).catch((error: unknown): RetentionKeepReason => {
      if (context.signal?.aborted === true) throw error
      return "state-unreadable"
    })
    if (outcome === "removed") tally.removed.push(sessionId)
    else if (outcome !== undefined) tally.keep(sessionId, outcome)
    context.budget?.done("journals", sessionId)
  }
  return tally.result()
}

async function visitJournal(
  context: RetentionContext,
  lazyGuard: LazyRetentionGuard,
  gate: UnreflectedRetentionGate | undefined,
  lock: JournalLock,
  sessionId: string,
): Promise<"removed" | RetentionKeepReason | undefined> {
  const dir = join(context.paths.transcripts, sessionId)
  const stats = await lstat(dir).catch(() => undefined)
  if (stats === undefined || !stats.isDirectory()) return undefined
  if (context.isLiveSession?.(sessionId) === true) return "live"
  if (existsSync(join(dir, LOCK))) return "locked"
  const first = await judge(context, dir, false, gate)
  if (typeof first === "string") return first
  // A candidate: only now is the reservation guard taken (J0 reads the reserved conversations).
  const guard = await lazyGuard.get()
  if (guard === undefined) return "scheduler-busy"
  if (guard.reservedConversationIds.has(sessionId)) return "reserved"
  await context.beforeJournalClaim?.(sessionId)
  return removeUnderLock(context, dir, lock, gate)
}

async function judge(context: RetentionContext, dir: string, holdingLock: boolean, gate: UnreflectedRetentionGate | undefined): Promise<Verdict> {
  const state = await readState(join(dir, STATE))
  if (state === "unreadable") return "state-unreadable"
  const kind = classify(state)
  if (typeof kind === "string") return kind
  if (kind.kind !== "never" && !existsSync(join(dir, TRANSCRIPT))) return "pruned"
  if (kind.kind !== "fully" && !context.policy.discardUnreflectedJournals) return "unreflected-retention-off"
  if (kind.kind !== "fully" && gate?.open !== true) return "reflection-unhealthy"
  const days = kind.kind === "fully" ? context.policy.retentionDays : context.policy.abandonedJournalDays
  const cutoff = context.now() - days * DAY_MS
  const newest = await newestFileMtime(dir, holdingLock)
  if (newest === undefined || newest > cutoff) return "recent"
  const startedAt = typeof state?.last_reflection_started_at === "string" ? Date.parse(state.last_reflection_started_at) : Number.NaN
  if (!Number.isNaN(startedAt) && startedAt > cutoff) return "recent"
  if (state !== undefined && !(await transcriptMatchesState(dir, state))) return "state-behind-transcript"
  return kind
}

/**
 * The state's counts describe exactly the transcript on disk (REVIEW-6 M1): every byte is a journal
 * row, and the completed steps and unreflected bytes derived from those rows equal what state.json
 * recorded. A row appended after the last state write moves at least one of them, so the class read
 * from the state no longer holds and nothing is removed.
 */
async function transcriptMatchesState(dir: string, state: Record<string, unknown>): Promise<boolean> {
  const size = (await lstat(join(dir, TRANSCRIPT)).catch(() => undefined))?.size
  if (size === undefined) return true
  const entries = await new TranscriptJournal({ journalDir: dir }).readEntriesSnapshot()
  const rowBytes = entries.reduce((total, entry) => total + Buffer.byteLength(`${JSON.stringify(entry)}\n`, "utf8"), 0)
  if (rowBytes !== size) return false
  const anchor = typeof state.reflected_through_message_id === "string" ? state.reflected_through_message_id : undefined
  const derived = deriveState({
    ...initialReflectionState(),
    ...(anchor === undefined ? {} : { reflected_through_message_id: anchor }),
    reflected_completed_steps: count(state.reflected_completed_steps) ?? 0,
  }, entries)
  if (derived.total_completed_steps !== count(state.total_completed_steps)) return false
  return state.unreflected_bytes === undefined || derived.unreflected_bytes === state.unreflected_bytes
}

function classify(state: Record<string, unknown> | undefined): { readonly kind: JournalClass } | RetentionKeepReason {
  if (state === undefined) return { kind: "never" }
  const total = count(state.total_completed_steps)
  const reflected = count(state.reflected_completed_steps)
  const since = count(state.steps_since_last_successful_reflection)
  if (total === undefined || reflected === undefined || since === undefined) return "unclassified"
  const anchor = typeof state.reflected_through_message_id === "string" && state.reflected_through_message_id.length > 0
  if (reflected === 0 && !anchor) return { kind: "never" }
  if (total > 0 && since === 0 && anchor) return state.pending_compaction === true ? "pending-compaction" : { kind: "fully" }
  if (reflected > 0 && since > 0 && anchor) return { kind: "partly" }
  return "unclassified"
}

/** An absent count is 0 (older states omit it); a present one must be a non-negative integer. */
function count(value: unknown): number | undefined {
  if (value === undefined) return 0
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

async function readState(path: string): Promise<Record<string, unknown> | undefined | "unreadable"> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : "unreadable"
  } catch {
    return "unreadable"
  }
}

/**
 * Newest mtime over the directory and its files. Under the lock the lock file is this pass's own and
 * creating it moved the directory mtime, so only the other files are judged (as journal/sweep.ts).
 */
async function newestFileMtime(dir: string, holdingLock: boolean): Promise<number | undefined> {
  let newest = holdingLock ? 0 : (await lstat(dir).catch(() => undefined))?.mtimeMs
  if (newest === undefined) return undefined
  for (const name of await listNames(dir)) {
    if (holdingLock && name === LOCK) continue
    const stamp = (await lstat(join(dir, name)).catch(() => undefined))?.mtimeMs
    if (stamp !== undefined && stamp > newest) newest = stamp
  }
  return newest
}

async function removeUnderLock(
  context: RetentionContext,
  dir: string,
  lock: JournalLock,
  gate: UnreflectedRetentionGate | undefined,
): Promise<"removed" | RetentionKeepReason> {
  let verdict: Verdict
  try {
    verdict = await lock(join(dir, LOCK), async () => {
      const current = await judge(context, dir, true, gate)
      if (typeof current === "string") return current
      if (current.kind === "never") {
        await unlinkIfPresent(join(dir, STATE))
        await unlinkIfPresent(join(dir, TRANSCRIPT))
      } else {
        await stampPruned(join(dir, STATE), context.now())
        await unlinkIfPresent(join(dir, TRANSCRIPT))
      }
      return current
    })
  } catch (error) {
    if (error instanceof JournalLockTimeoutError) return "locked"
    throw error
  }
  if (typeof verdict === "string") return verdict
  if (verdict.kind !== "never") return "removed"
  try {
    await rmdir(dir)
    return "removed"
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") return "removed"
    if (code === "ENOTEMPTY" || code === "EEXIST") return "changed-during-removal"
    throw error
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error
  })
}

async function stampPruned(statePath: string, now: number): Promise<void> {
  const state = await readState(statePath)
  if (state === "unreadable" || state === undefined) throw new Error(`journal state vanished under its lock: ${statePath}`)
  const temporary = `${statePath}.tmp-${randomUUID()}`
  try {
    const { reflected_through_byte_offset: _offset, ...kept } = state
    await writeFile(temporary, `${JSON.stringify({ ...kept, transcript_pruned_at: new Date(now).toISOString() }, null, 2)}\n`, "utf8")
    await rename(temporary, statePath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * Lock-free verdict for one journal under `context.policy` and `gate`; the cap passes its tier floors
 * as the policy and an open gate to learn each journal's class, then applies the switch and gate itself.
 */
/**
 * One `transcripts/` entry for the cap and the doctors' scans, tolerant like the pass's visit: a name
 * that is not a directory is skipped (undefined), and an entry whose judgement throws (a state.json that
 * is a directory, an I/O error) is kept as `state-unreadable` so the scan goes on. An abort propagates.
 */
export async function classifyJournalEntry(
  context: RetentionContext,
  dir: string,
  gate: UnreflectedRetentionGate = { open: true },
): Promise<Verdict | undefined> {
  context.signal?.throwIfAborted()
  const stats = await lstat(dir).catch(() => undefined)
  if (stats === undefined || !stats.isDirectory()) return undefined
  return judge(context, dir, false, gate).catch((error: unknown): RetentionKeepReason => {
    if (context.signal?.aborted === true) throw error
    return "state-unreadable"
  })
}

export { removeUnderLock as removeTranscriptJournalUnderLock }
