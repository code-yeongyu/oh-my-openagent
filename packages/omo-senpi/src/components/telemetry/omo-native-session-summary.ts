import { createHash } from "node:crypto"

import type { EventTelemetryProperties, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import type { OmoNativeEventName } from "./product-identity"
import type { ConsentScope, StoredRollup, SummaryStore } from "./session-summary-store"
import {
  addTurn,
  openWindow,
  summaryProperties,
  type EndedBy,
  type SummaryTurn,
  type SummaryWindow,
} from "./session-summary-window"

export type { SummaryTurn } from "./session-summary-window"

// Share of sessions whose raw turn_completed rows go to PostHog. Turns are sampled here only because
// PostHog is today's only sink; the first-party collector receives every turn through its own path.
export const RAW_TURN_SAMPLE_RATE = 0.05
export const CHECKPOINT_MAX_TURNS = 50
export const CHECKPOINT_MAX_WINDOW_MS = 30 * 60_000

export type SessionSummaryOptions = {
  readonly captureEvent: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
  readonly store: SummaryStore
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly sessionRole?: string
  /**
   * Asked before every write, because consent can change mid-session. Without it nothing is recorded,
   * and the session's own rollup file is deleted so no later process can send it.
   */
  readonly isConsented?: (options?: { readonly fresh?: boolean }) => boolean
  /** The scope `isConsented` reads right now; stamped into every persisted window. */
  readonly consentScope?: () => ConsentScope
  /**
   * Consent for the scope a persisted window came from, read when it is about to be sent or resumed:
   * consent at send time wins over the mark written while the session was still opted in.
   */
  readonly isScopeConsented?: (scope: ConsentScope) => boolean
  /**
   * Arms a periodic consent check while a window sits on disk, so an opt-out deletes it even when no
   * further turn or shutdown arrives (a kill right after opting out). Returns the disarm function.
   */
  readonly scheduleConsentCheck?: (check: () => void) => () => void
  readonly now?: () => number
  readonly sampleRate?: number
}

export type SessionSummaryRecorder = {
  readonly isRawTurnSampled: (sessionHash: string) => boolean
  readonly sampleRate: number
  readonly recordTurn: (sessionHash: string, turn: SummaryTurn) => void
  /** `reload` keeps the session's sequence and file so the next registration continues it. */
  readonly finish: (sessionHash: string, reason: string | undefined) => void
  /** Re-reads consent and, when it is off, deletes every window this process left on disk. */
  readonly purgeIfOptedOut: () => void
  /** Stops the periodic consent check; the session is going away. */
  readonly dispose: () => void
}

type Live = { nextSeq: number; window: SummaryWindow | null }

export function isSessionSampled(sessionHash: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  const bucket = createHash("sha256").update(`turn-sample:${sessionHash}`).digest().readUInt32BE(0)
  return bucket / 0x1_0000_0000 < sampleRate
}

export function createSessionSummaryRecorder(options: SessionSummaryOptions): SessionSummaryRecorder {
  const now = options.now ?? Date.now
  const sampleRate = options.sampleRate ?? RAW_TURN_SAMPLE_RATE
  const sessionRole = options.sessionRole ?? "main"
  const isConsented = options.isConsented ?? (() => true)
  const consentScope = options.consentScope ?? (() => ({}))
  const isScopeConsented = options.isScopeConsented ?? (() => true)
  const live = new Map<string, Live>()
  // Seqs a session already used before it opted out, so opting back in never reuses a sent seq.
  const retiredSeq = new Map<string, number>()
  // Sessions with a file this process wrote; the periodic consent check runs only while one exists.
  const onDisk = new Set<string>()
  let disarm: (() => void) | undefined
  let recovered = false

  const track = (sessionHash: string, present: boolean): void => {
    if (present) onDisk.add(sessionHash)
    else onDisk.delete(sessionHash)
    if (onDisk.size > 0 && disarm === undefined && options.scheduleConsentCheck !== undefined) {
      disarm = options.scheduleConsentCheck(() => purgeIfOptedOut())
    } else if (onDisk.size === 0 && disarm !== undefined) {
      disarm()
      disarm = undefined
    }
  }

  // Only a window marked opted in, whose originating scope is still opted in now, may be sent or resumed.
  // A scope that cannot be read back (an older file, a damaged field) fails closed.
  const stillConsented = (rollup: StoredRollup): ConsentScope | undefined => {
    if (rollup.consent !== "enabled") return undefined
    const scope = readScope(rollup.scope)
    return scope !== undefined && isScopeConsented(scope) ? scope : undefined
  }

  const emit = (sessionHash: string, window: SummaryWindow, seq: number, endedBy: EndedBy, role: string): void => {
    options.captureEvent("session_summary", summaryProperties(sessionHash, window, {
      endedBy,
      seq,
      sampleRate,
      sampled: isSessionSampled(sessionHash, sampleRate),
      sessionRole: role,
    }))
  }

  // Rollups a crashed or killed process left behind are sent once, from the first live event, so the
  // capture path is already installed and only one of several racing processes claims each file. The
  // claimer leaves a window-less placeholder carrying the next seq (and the orphan's age, so it expires),
  // because the user may resume that session in any other process. An orphan without the opted-in mark
  // (an opted-out session, or a file older than the mark) was claimed, which deleted it, and is not sent.
  const recoverOrphans = (): void => {
    if (recovered) return
    recovered = true
    for (const orphan of options.store.claimOrphans()) {
      const scope = stillConsented(orphan)
      if (scope === undefined) continue
      const nextSeq = orphan.window === null ? orphan.nextSeq : orphan.nextSeq + 1
      if (nextSeq > 0) {
        writeSafely({ sessionHash: orphan.sessionHash, sessionRole: orphan.sessionRole, nextSeq, window: null, updatedAt: orphan.updatedAt, consent: "enabled", scope })
      }
      if (orphan.window !== null) emit(orphan.sessionHash, orphan.window, orphan.nextSeq, "recovered", orphan.sessionRole)
    }
  }

  const liveFor = (sessionHash: string): Live => {
    const cached = live.get(sessionHash)
    if (cached !== undefined) return cached
    const stored = options.store.read(sessionHash)
    const resumable = stored !== undefined && stillConsented(stored) !== undefined
    const entry: Live = resumable ? { nextSeq: stored.nextSeq, window: stored.window } : { nextSeq: 0, window: null }
    entry.nextSeq = Math.max(entry.nextSeq, retiredSeq.get(sessionHash) ?? 0)
    live.set(sessionHash, entry)
    return entry
  }

  const persist = (sessionHash: string, entry: Live): void => {
    writeSafely({ sessionHash, sessionRole, nextSeq: entry.nextSeq, window: entry.window, consent: "enabled", scope: consentScope() })
  }

  const remove = (sessionHash: string): void => {
    options.store.remove(sessionHash)
    track(sessionHash, false)
  }

  const discard = (sessionHash: string): void => {
    const used = live.get(sessionHash)?.nextSeq ?? options.store.read(sessionHash)?.nextSeq ?? 0
    if (used > 0) retiredSeq.set(sessionHash, Math.max(used, retiredSeq.get(sessionHash) ?? 0))
    live.delete(sessionHash)
    try {
      remove(sessionHash)
    } catch (error) {
      options.diagnostics?.({
        event: "telemetry_activity_state_write_failed",
        source: "omo-native-session-summary",
        error: error instanceof Error ? error : new Error(String(error)),
        errorKind: "error",
      })
    }
  }

  function writeSafely(rollup: Parameters<SummaryStore["write"]>[0]): void {
    try {
      options.store.write(rollup)
      track(rollup.sessionHash, true)
    } catch (error) {
      options.diagnostics?.({
        event: "telemetry_activity_state_write_failed",
        source: "omo-native-session-summary",
        error: error instanceof Error ? error : new Error(String(error)),
        errorKind: "error",
      })
    }
  }

  // The closed window leaves disk BEFORE it is sent: a crash in between loses one window instead of
  // sending it twice, so summed totals can only undercount, never double count.
  const flush = (sessionHash: string, entry: Live, endedBy: EndedBy): void => {
    const window = entry.window ?? openWindow(now(), 0)
    const seq = entry.nextSeq
    entry.nextSeq += 1
    entry.window = null
    if (endedBy === "shutdown") remove(sessionHash)
    else persist(sessionHash, entry)
    emit(sessionHash, window, seq, endedBy, sessionRole)
  }

  return {
    sampleRate,
    isRawTurnSampled: (sessionHash) => isSessionSampled(sessionHash, sampleRate),
    recordTurn(sessionHash, turn) {
      if (!isConsented()) return discard(sessionHash)
      recoverOrphans()
      const entry = liveFor(sessionHash)
      const at = now()
      entry.window ??= openWindow(at, turn.turnIndex)
      addTurn(entry.window, turn, at)
      if (entry.window.totals.length >= CHECKPOINT_MAX_TURNS || at - entry.window.startedAt >= CHECKPOINT_MAX_WINDOW_MS) {
        flush(sessionHash, entry, "checkpoint")
      } else {
        persist(sessionHash, entry)
      }
    },
    finish(sessionHash, reason) {
      if (!isConsented()) return discard(sessionHash)
      recoverOrphans()
      const entry = liveFor(sessionHash)
      live.delete(sessionHash)
      if (reason === "reload") {
        if (entry.window !== null) flush(sessionHash, entry, "reload")
        else if (entry.nextSeq > 0) persist(sessionHash, entry)
        return
      }
      if (entry.window !== null || entry.nextSeq > 0) flush(sessionHash, entry, "shutdown")
      else remove(sessionHash)
    },
    purgeIfOptedOut,
    dispose() {
      disarm?.()
      disarm = undefined
    },
  }

  function purgeIfOptedOut(): void {
    if (onDisk.size === 0 && live.size === 0) return
    if (isConsented({ fresh: true })) return
    for (const sessionHash of new Set([...onDisk, ...live.keys()])) discard(sessionHash)
  }
}

function readScope(value: unknown): ConsentScope | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const cwd: unknown = Reflect.get(value, "cwd")
  if (cwd === undefined) return {}
  return typeof cwd === "string" ? { cwd } : undefined
}
