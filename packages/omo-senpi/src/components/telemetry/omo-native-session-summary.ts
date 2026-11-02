import { randomUUID } from "node:crypto"
import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import type { TelemetrySessionRole } from "./session-role"
import { CORRUPT } from "./session-summary-files"
import type { SummaryPublish } from "./session-summary-delivery"
import { createSummaryPublisher } from "./session-summary-publisher"
import { createLazySummaryRecovery, memoizeLoad, type LoadSummaryRecovery } from "./session-summary-lazy-recovery"
import { isSessionSampled } from "./session-summary-sampling"
import { isRecordSendable, type ConsentScope, type SummaryStorage, type WindowRecord } from "./session-summary-storage"
import { addTurn, newSummaryEpoch, openWindow, type EndedBy, type SummaryTurn, type SummaryWindow } from "./session-summary-window"

export type { SummaryTurn } from "./session-summary-window"
export type { SummaryPublication } from "./session-summary-publisher"
export { RAW_TURN_SAMPLE_RATE, isSessionSampled } from "./session-summary-sampling"

export const CHECKPOINT_MAX_TURNS = 50
export const CHECKPOINT_MAX_WINDOW_MS = 30 * 60_000
export const HEARTBEAT_INTERVAL_MS = 60_000

export type ScheduleHeartbeat = (tick: () => void, intervalMs: number) => () => void

export type SessionSummaryOptions = {
  /**
   * Asked before every write, because consent can change mid-session. Without it nothing is recorded, and
   * the session's own window file is deleted so no later process can send it. Defaults to consented.
   */
  readonly isConsented?: (check?: { readonly fresh?: boolean }) => boolean
  /** The scope `isConsented` reads right now; stamped into every persisted record. Without a cwd nothing is ever sent. */
  readonly consentScope: () => ConsentScope
  /**
   * Consent for the scope a persisted record came from, read when it is about to be sent or resumed:
   * consent at send time wins over the mark written while the session was still opted in.
   */
  readonly isScopeConsented?: (scope: ConsentScope) => boolean
  /**
   * Arms a periodic consent check while a window sits on disk, so an opt-out deletes it even when no
   * further turn or shutdown arrives (a kill right after opting out). Returns the disarm function.
   */
  readonly scheduleConsentCheck?: (check: () => void) => () => void
  readonly storage: SummaryStorage
  /** The capture state publishes through the sidecar, so the entry bundle carries no publish code. */
  readonly publish: SummaryPublish
  readonly sessionRole: TelemetrySessionRole
  /** Read when a window opens; the component resolves config, env and sink lazily behind it. */
  readonly sampleRate: () => number
  readonly now?: () => number
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly scheduleHeartbeat?: ScheduleHeartbeat
  /** Events the transport knows it dropped since the last call (todo 21 wires the OTLP sender's counter). */
  readonly droppedEvents?: () => number
  /** Loads the recovery sweep and the send step; defaults to the `#omo-telemetry-recovery-runtime` sidecar. */
  readonly loadRecovery?: LoadSummaryRecovery
}

export type SessionSummaryRecorder = {
  readonly sampleRate: number
  readonly isRawTurnSampled: (sessionHash: string) => boolean
  /** Re-sends unacknowledged events (this process's and dead ones') and recovers abandoned windows. */
  readonly recover: () => Promise<void>
  /** Resolves when every publication this call started has been acknowledged or given up. */
  readonly recordTurn: (sessionHash: string, turn: SummaryTurn) => Promise<void>
  /** `reload` keeps the session's sequence so the next registration continues it. */
  readonly finish: (sessionHash: string, reason: string | undefined) => Promise<void>
  /** Re-reads consent and, when it is off, deletes every window this process left on disk. */
  readonly purgeIfOptedOut: () => void
  /** Stops the periodic consent check; the session is going away. */
  readonly dispose: () => void
  /** Resolves once the recorder can persist a turn synchronously (the lazy facade loads its sidecar). */
  readonly prepare?: () => Promise<void>
}

export type LiveWindow = {
  key: string
  epoch: string
  seq: number
  sampleRate: number
  windowId: string | null
  window: SummaryWindow | null
}

export function createSessionSummaryRecorder(options: SessionSummaryOptions): SessionSummaryRecorder {
  const { storage } = options
  const now = options.now ?? storage.now
  const isConsented = options.isConsented ?? (() => true)
  const { consentScope } = options
  const isScopeConsented = options.isScopeConsented ?? (() => true)
  // A normal turn loads nothing: the sidecar is loaded when a window closes, a sweep has work, or a session
  // continues a window another process wrote (only the sidecar can tell whether that owner is alive).
  const loadSidecar = memoizeLoad(options.loadRecovery ?? (() => import("#omo-telemetry-recovery-runtime")))
  const publisher = createSummaryPublisher({
    storage,
    publish: options.publish,
    loadDelivery: loadSidecar,
    isScopeConsented,
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    ...(options.droppedEvents === undefined ? {} : { transportDropped: options.droppedEvents }),
  })
  const live = new Map<string, LiveWindow>()
  // Window files this process wrote, by session; the periodic consent check runs only while one exists.
  const onDisk = new Map<string, string>()
  const recovery = createLazySummaryRecovery({
    storage,
    publisher,
    isScopeConsented,
    ownWindowKeys: () => onDisk.values(),
    load: loadSidecar,
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
  })
  let disarmConsentCheck: (() => void) | undefined
  let swept = false
  let stopHeartbeat: (() => void) | undefined

  const track = (sessionHash: string, key: string | undefined): void => {
    if (key === undefined) onDisk.delete(sessionHash)
    else onDisk.set(sessionHash, key)
    if (onDisk.size > 0 && disarmConsentCheck === undefined && options.scheduleConsentCheck !== undefined) {
      disarmConsentCheck = options.scheduleConsentCheck(() => purgeIfOptedOut())
    } else if (onDisk.size === 0 && disarmConsentCheck !== undefined) {
      disarmConsentCheck()
      disarmConsentCheck = undefined
    }
  }

  const removeWindow = (sessionHash: string, key: string): void => {
    storage.removeWindow(key)
    if (onDisk.get(sessionHash) === key) track(sessionHash, undefined)
  }

  const report = (error: unknown): void => publisher.report("telemetry_activity_state_write_failed", error)

  const recordOf = (sessionHash: string, entry: LiveWindow): WindowRecord => ({
    consent: "enabled",
    scope: consentScope(),
    sessionHash,
    sessionRole: options.sessionRole,
    owner: storage.owner,
    heartbeatAt: now(),
    epoch: entry.epoch,
    seq: entry.seq,
    sampleRate: entry.sampleRate,
    windowId: entry.windowId,
    window: entry.window,
  })

  const persist = (sessionHash: string, entry: LiveWindow): void => {
    try {
      storage.writeWindow(entry.key, recordOf(sessionHash, entry))
      track(sessionHash, entry.key)
    } catch (error) {
      report(error)
    }
  }

  // Opting out drops the session with nothing left on disk: its live state and its window file. Opting back
  // in starts a new epoch, so no (epoch, seq) pair it already sent can repeat.
  const discard = (sessionHash: string): void => {
    const key = live.get(sessionHash)?.key ?? onDisk.get(sessionHash)
    live.delete(sessionHash)
    if (key === undefined) return
    try {
      removeWindow(sessionHash, key)
    } catch (error) {
      report(error)
    }
  }

  function purgeIfOptedOut(): void {
    if (onDisk.size === 0 && live.size === 0) return
    if (isConsented({ fresh: true })) return
    for (const sessionHash of new Set([...onDisk.keys(), ...live.keys()])) discard(sessionHash)
  }

  const heartbeat = (): void => {
    purgeIfOptedOut()
    if (!isConsented()) return
    // An idle session writes no window, so the tick itself keeps this owner's entry (boot id, start time) on disk.
    try {
      storage.register()
    } catch (error) {
      report(error)
    }
    for (const [sessionHash, entry] of live) if (entry.window !== null) persist(sessionHash, entry)
    void runSweep()
  }

  // A sweep still loading its module is awaited by the next turn, which the synchronous sweep always preceded.
  let sweepInFlight: Promise<void> | undefined
  const runSweep = (): Promise<void> | undefined => {
    try {
      const loading = recovery.sweep()?.catch(report)
      if (loading === undefined) return undefined
      const settled = loading.finally(() => {
        if (sweepInFlight === settled) sweepInFlight = undefined
      })
      sweepInFlight = settled
      return settled
    } catch (error) {
      report(error)
      return undefined
    }
  }

  const sweepOnce = (): Promise<void> | undefined => {
    if (swept) return sweepInFlight
    swept = true
    return runSweep()
  }

  const isOwn = (owner: WindowRecord["owner"]) => owner.pid === storage.owner.pid && owner.bootId === storage.owner.bootId

  // Before a session adopts a window another process wrote, the sidecar (owner liveness, claims) must be loaded.
  const loadLivenessFor = (sessionHash: string): Promise<unknown> | undefined => {
    if (live.has(sessionHash) || recovery.runtime() !== undefined) return undefined
    const stored = storage.readWindow(storage.windowKey(sessionHash))
    return typeof stored === "object" && !isOwn(stored.owner) ? recovery.load().catch(report) : undefined
  }

  // What a turn or shutdown waits for first: the first sweep, then the liveness check it may need.
  const ready = (sessionHash: string): Promise<unknown> | undefined => {
    const sweeping = sweepOnce()
    return sweeping === undefined ? loadLivenessFor(sessionHash) : sweeping.then(() => loadLivenessFor(sessionHash))
  }

  const ensureHeartbeat = (): void => {
    if (stopHeartbeat !== undefined) return
    stopHeartbeat = (options.scheduleHeartbeat ?? scheduleUnrefInterval)(heartbeat, HEARTBEAT_INTERVAL_MS)
  }

  const liveFor = (sessionHash: string): LiveWindow => {
    const cached = live.get(sessionHash)
    if (cached !== undefined) return cached
    const entry = adopt(sessionHash)
    live.set(sessionHash, entry)
    return entry
  }

  // A session's file is continued by whoever records its next turn: this process's own file, or the file
  // of a dead owner (claimed first, so two resuming processes never both continue it). Continuing a file keeps
  // its epoch and seq; anything else (no usable file, a LIVE process's file, a lost claim) starts a new epoch at
  // seq 0, so an own copy beside another process's window can never publish that window's (epoch, seq).
  const adopt = (sessionHash: string): LiveWindow => {
    const key = storage.windowKey(sessionHash)
    const fresh = (entryKey = key, epoch = newSummaryEpoch(), seq = 0): LiveWindow => ({
      key: entryKey, epoch, seq, sampleRate: options.sampleRate(), windowId: null, window: null,
    })
    const ownCopy = storage.windowKey(sessionHash, true)
    const stored = storage.readWindow(key)
    if (stored === undefined || stored === CORRUPT) return fresh()
    // Only a window marked opted in, whose originating scope is still opted in now, may be continued.
    if (!isRecordSendable(stored, isScopeConsented)) {
      storage.removeWindow(key)
      return fresh()
    }
    if (isOwn(stored.owner)) {
      return { key, epoch: stored.epoch ?? newSummaryEpoch(), seq: stored.seq, sampleRate: stored.sampleRate, windowId: stored.windowId, window: stored.window }
    }
    // Without the sidecar (its load failed, already reported) the owner counts as alive: nothing is claimed.
    return recovery.runtime()?.adopt({ key, ownCopy, stored, isScopeConsented, fresh, persist: (entry) => persist(sessionHash, entry) }) ?? fresh(ownCopy)
  }

  const close = (sessionHash: string, entry: LiveWindow, endedBy: EndedBy, keepFile: boolean): void => {
    const window = entry.window ?? openWindow(now(), 0)
    const windowId = entry.windowId ?? randomUUID()
    const seq = entry.seq
    void publisher.publishWindow({
      consent: "enabled", scope: consentScope(), sessionHash, sessionRole: options.sessionRole, sampleRate: entry.sampleRate, epoch: entry.epoch, seq, windowId, window, endedBy,
    }, () => {
      entry.seq = seq + 1
      entry.window = null
      entry.windowId = null
      if (keepFile) persist(sessionHash, entry)
      else removeWindow(sessionHash, entry.key)
    })
  }

  return {
    get sampleRate() {
      return options.sampleRate()
    },
    isRawTurnSampled: (sessionHash) => isSessionSampled(sessionHash, options.sampleRate()),
    async recover() {
      if (!isConsented()) return
      swept = true
      await runSweep()
      await publisher.settled()
    },
    async recordTurn(sessionHash, turn) {
      if (!isConsented()) return discard(sessionHash)
      const waiting = ready(sessionHash)
      if (waiting !== undefined) await waiting
      ensureHeartbeat()
      const entry = liveFor(sessionHash)
      const at = now()
      if (entry.window === null) {
        entry.windowId = randomUUID()
        entry.window = openWindow(at, turn.turnIndex)
        entry.sampleRate = options.sampleRate()
      }
      addTurn(entry.window, turn, at)
      if (entry.window.totals.length >= CHECKPOINT_MAX_TURNS || at - entry.window.startedAt >= CHECKPOINT_MAX_WINDOW_MS) {
        close(sessionHash, entry, "checkpoint", true)
      } else {
        persist(sessionHash, entry)
      }
      await publisher.settled()
    },
    async finish(sessionHash, reason) {
      if (!isConsented()) return discard(sessionHash)
      const waiting = ready(sessionHash)
      if (waiting !== undefined) await waiting
      const entry = liveFor(sessionHash)
      live.delete(sessionHash)
      if (live.size === 0) {
        stopHeartbeat?.()
        stopHeartbeat = undefined
      }
      const ownCopy = entry.key !== storage.windowKey(sessionHash)
      if (reason === "reload") {
        if (entry.window !== null) close(sessionHash, entry, "reload", !ownCopy)
        else if (entry.seq > 0 && !ownCopy) persist(sessionHash, entry)
      } else if (entry.window !== null || entry.seq > 0) {
        close(sessionHash, entry, "shutdown", !ownCopy)
      } else {
        removeWindow(sessionHash, entry.key)
      }
      await publisher.settled()
    },
    purgeIfOptedOut,
    dispose() {
      disarmConsentCheck?.()
      disarmConsentCheck = undefined
    },
  }
}

function scheduleUnrefInterval(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
