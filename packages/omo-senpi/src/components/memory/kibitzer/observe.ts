// Durable, bounded observability and retention of the resident Kibitzer.
//
// `recall/sidecars/<encoded-session>/` is one main session's audit directory: the child's own
// session JSONL (senpi writes it there because the ChildSpec's `sessionDir` points at it) plus
// `wakes.ndjson`, one line per settled wake. Every line is a closed record - status, cause, model,
// cursor span, tool calls, duration, provider usage, delivered paths - bounded field by field and
// then as a whole, with the failure reason masked (memory-core and senpi secret patterns) and cut
// before any stack frame, so nothing a provider or a child error said verbatim reaches disk.
//
// The `omo-kibitzer:gate` notice moves here from the one-shot gate wiring with its policy intact:
// an isolated failure is silent (the ndjson line is its only trace); the third consecutive
// diagnostic failure of one main session appends exactly one actionable notice; a normal
// completion or the session's shutdown resets the streak.
//
// Retention: a sidecar directory idle for seven days is removed - never while a session owns it.
// Ownership is an ordinary memory-core lock (`locks/recall-sidecar.<encoded-session>.lock`) held
// from sidecar creation to session shutdown, so a sweep from another process sees a live owner
// (contention) and skips, while a crashed owner is recovered only on pid/start-identity proof, as
// every other lock domain does. This process's own live sessions are skipped before any lock is
// touched. The sweep runs once per identity when its first sidecar comes alive and again at every
// session shutdown; a directory is claimed by rename under its owner lock and deleted afterwards,
// and a tombstone left by a crash is cleared by the next sweep.
//
// This module is the instance and the public surface; the pieces live beside it: `observe-paths`
// (directory identity and the owner lock path), `observe-record` (the bounded wake line) and
// `observe-prune` (the sweep).

import { acquireLock, createLockRecord, releaseLock, type LockRecord } from "@oh-my-opencode/memory-core"
import { appendFile, mkdir } from "@oh-my-opencode/memory-core/fs"

import type { ComponentLogger } from "../../../extension/types"
import type { MemoryIdentityContext } from "../context"
import { redactKibitzerEventText } from "./events"
import { GATE_ENTRY_TYPE, type KibitzerGateRecord } from "./notice"
import { OWNER_LOCK_PURPOSE, encodeKibitzerSessionId, kibitzerSidecarSessionDir, kibitzerWakesFile, ownerLockPathFor } from "./observe-paths"
import { KIBITZER_SIDECAR_RETENTION_MS, pruneKibitzerSidecars } from "./observe-prune"
import { WAKE_MODEL_MAX_CHARS, capped, kibitzerWakeRecord, redactKibitzerWakeReason } from "./observe-record"
import type { KibitzerWakeOutcome } from "./sidecar-outcome"

export {
  KIBITZER_WAKES_FILENAME,
  decodeKibitzerSidecarDirName,
  encodeKibitzerSessionId,
  kibitzerSidecarOwnerLockPath,
  kibitzerSidecarSessionDir,
  kibitzerSidecarsRoot,
  kibitzerWakesFile,
} from "./observe-paths"
export { KIBITZER_SIDECAR_RETENTION_MS, pruneKibitzerSidecars, type PruneKibitzerSidecarsOptions, type PruneKibitzerSidecarsResult } from "./observe-prune"
export { KIBITZER_WAKE_RECORD_MAX_CHARS, kibitzerWakeRecord, redactKibitzerWakeReason, type KibitzerWakeRecord } from "./observe-record"

/** Consecutive diagnostic failures of one main session before the single actionable notice. */
export const KIBITZER_PERSISTENT_FAILURE_THRESHOLD = 3
/** How long a sidecar coming alive waits for its owner lock: long enough to outlast a sweep's claim. */
const OWNER_LOCK_WAIT_MS = 2_000

export interface KibitzerObservabilityOptions {
  /** The main session's entry sink; the gate notice is the only entry this module appends. */
  readonly appendEntry: (customType: string, data?: unknown) => void
  readonly now?: () => number
  readonly retentionMs?: number
  readonly logger?: ComponentLogger
}

export interface KibitzerObservability {
  /** A session's sidecar exists from now on: its directory is owned - never pruned - until shutdown. */
  own(sessionId: string, context: MemoryIdentityContext): void
  /** One settled wake: one ndjson line, then the diagnostic streak. Synchronous, never throws. */
  onWake(outcome: KibitzerWakeOutcome, context: MemoryIdentityContext): void
  /**
   * Makes the session's queued records durable, releases its directory, forgets its streak and
   * sweeps the identity's aged sidecar directories (detached; `whenIdle` covers it).
   */
  onSessionShutdown(sessionId: string, context: MemoryIdentityContext): Promise<void>
  /** Resolves once every queued write, lock transition and sweep has ended. */
  whenIdle(): Promise<void>
}

interface Ownership {
  readonly encoded: string
  readonly lockPath: string
  /** The record the lock was published with; undefined when the lock could not be taken. */
  readonly lock: Promise<LockRecord | undefined>
}

interface Streak {
  count: number
  notified: boolean
}

export function createKibitzerObservability(options: KibitzerObservabilityOptions): KibitzerObservability {
  const now = options.now ?? Date.now
  const retentionMs = options.retentionMs ?? KIBITZER_SIDECAR_RETENTION_MS
  const owned = new Map<string, Ownership>()
  const streaks = new Map<string, Streak>()
  /** Per-session write chains: one file, one writer, lines in wake order. */
  const writers = new Map<string, Promise<void>>()
  const sweeping = new Map<string, Promise<void>>()
  const sweptOnce = new Set<string>()
  const inFlight = new Set<Promise<unknown>>()

  function warn(message: string, details: Record<string, unknown>): void {
    options.logger?.warn(message, details)
  }

  function track<T>(promise: Promise<T>): Promise<T> {
    const tracked: Promise<T> = promise.finally(() => inFlight.delete(tracked))
    inFlight.add(tracked)
    return tracked
  }

  // ---- ownership -----------------------------------------------------------------------------------

  async function takeOwnerLock(lockPath: string, sessionId: string): Promise<LockRecord | undefined> {
    try {
      const record = await createLockRecord(OWNER_LOCK_PURPOSE)
      await acquireLock(lockPath, record, { waitTimeoutMs: OWNER_LOCK_WAIT_MS })
      return record
    } catch (error) {
      warn("omo-senpi kibitzer sidecar directory owner lock unavailable", { sessionId, lockPath, error: describe(error) })
      return undefined
    }
  }

  function own(sessionId: string, context: MemoryIdentityContext): void {
    if (owned.has(sessionId)) return
    const encoded = encodeKibitzerSessionId(sessionId)
    const lockPath = ownerLockPathFor(context.identityPaths.locks, encoded)
    owned.set(sessionId, { encoded, lockPath, lock: track(takeOwnerLock(lockPath, sessionId)) })
    const recallDir = context.identityPaths.recall
    if (sweptOnce.has(recallDir)) return
    sweptOnce.add(recallDir)
    sweep(context)
  }

  async function disown(sessionId: string): Promise<void> {
    const ownership = owned.get(sessionId)
    if (ownership === undefined) return
    owned.delete(sessionId)
    const record = await ownership.lock
    if (record === undefined) return
    try {
      await releaseLock(ownership.lockPath, record)
    } catch (error) {
      warn("omo-senpi kibitzer sidecar directory owner lock release failed", { sessionId, lockPath: ownership.lockPath, error: describe(error) })
    }
  }

  // ---- the wake record -----------------------------------------------------------------------------

  async function appendWake(context: MemoryIdentityContext, sessionId: string, line: string): Promise<void> {
    const file = kibitzerWakesFile(context.identityPaths.recall, sessionId)
    try {
      await mkdir(kibitzerSidecarSessionDir(context.identityPaths.recall, sessionId), { recursive: true, mode: 0o700 })
      await appendFile(file, line, { encoding: "utf8", mode: 0o600 })
    } catch (error) {
      warn("omo-senpi kibitzer wake record write failed", { sessionId, file, error: describe(error) })
    }
  }

  function onWake(outcome: KibitzerWakeOutcome, context: MemoryIdentityContext): void {
    const line = `${JSON.stringify(kibitzerWakeRecord(outcome, now()))}\n`
    const previous = writers.get(outcome.sessionId) ?? Promise.resolve()
    const next = track(previous.then(() => appendWake(context, outcome.sessionId, line)))
    writers.set(outcome.sessionId, next)
    void next.finally(() => {
      if (writers.get(outcome.sessionId) === next) writers.delete(outcome.sessionId)
    })
    observeStreak(outcome)
  }

  // ---- the diagnostic streak -----------------------------------------------------------------------

  function observeStreak(outcome: KibitzerWakeOutcome): void {
    if (!outcome.diagnostic) {
      streaks.delete(outcome.sessionId)
      return
    }
    const streak = streaks.get(outcome.sessionId) ?? { count: 0, notified: false }
    streak.count += 1
    streaks.set(outcome.sessionId, streak)
    if (streak.count < KIBITZER_PERSISTENT_FAILURE_THRESHOLD || streak.notified) return
    streak.notified = true
    const reason = redactKibitzerWakeReason(outcome.reason)
    const record: KibitzerGateRecord = {
      version: 1,
      status: "failed",
      cause: outcome.cause ?? "child_failed",
      ...(outcome.model === undefined ? {} : { model: capped(redactKibitzerEventText(outcome.model), WAKE_MODEL_MAX_CHARS) }),
      candidateCount: outcome.candidateCount,
      ...(reason === undefined ? {} : { reason }),
      consecutiveFailures: streak.count,
      wake: outcome.wake,
    }
    try {
      options.appendEntry(GATE_ENTRY_TYPE, record)
    } catch (error) {
      warn("omo-senpi kibitzer gate notice append failed", { sessionId: outcome.sessionId, error: describe(error) })
    }
  }

  // ---- retention -----------------------------------------------------------------------------------

  function sweep(context: MemoryIdentityContext): void {
    const recallDir = context.identityPaths.recall
    if (sweeping.has(recallDir)) return
    const run = track(pruneKibitzerSidecars({
      recallDir,
      locksDir: context.identityPaths.locks,
      now,
      maxAgeMs: retentionMs,
      owned: new Set([...owned.values()].map((ownership) => ownership.encoded)),
      warn,
    }).then(() => undefined, (error: unknown) => {
      warn("omo-senpi kibitzer sidecar sweep failed", { recallDir, error: describe(error) })
    }).finally(() => {
      sweeping.delete(recallDir)
    }))
    sweeping.set(recallDir, run)
  }

  return {
    own,
    onWake,
    async onSessionShutdown(sessionId, context): Promise<void> {
      streaks.delete(sessionId)
      await (writers.get(sessionId) ?? Promise.resolve())
      await disown(sessionId)
      sweep(context)
    },
    async whenIdle(): Promise<void> {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
