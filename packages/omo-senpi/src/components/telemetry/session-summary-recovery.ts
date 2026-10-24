import { statSync } from "node:fs"
import { join } from "node:path"
import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import { CORRUPT, removeFile, renameIfPresent } from "./session-summary-files"
import type { SummaryPublisher } from "./session-summary-publisher"
import type { LiveWindow } from "./omo-native-session-summary"
import { adoptForeignWindow } from "./session-summary-adopt"
import { withRecoveryOps, type RecoveryStorage } from "./session-summary-recovery-storage"
import { purgeOptedOutQueue } from "./session-summary-optout-purge"
import { newSummaryEpoch } from "./session-summary-window"
import { currentProcessOwner } from "./session-summary-owner"
import {
  OWNER_STALE_MS,
  SUMMARY_TTL_MS,
  createSummaryStorage,
  isRecordSendable,
  type Claimed,
  type ConsentScope,
  type PendingRecord,
  type ReadResult,
  type SummaryStorage,
  type WindowRecord,
} from "./session-summary-storage"

// The sidecar's whole surface: this file is the `#omo-telemetry-recovery-runtime` entry, and the bundle maps
// telemetry-core's `#telemetry-immediate-send` here too, so every lazily loaded telemetry part shares one file.
// The sender comes from its own module, not the telemetry-core barrel, so posthog-node stays out of the sidecar.
export { adoptForeignWindow, withRecoveryOps }
export { sendSummaryRecord } from "./session-summary-delivery"
export { createImmediateSender } from "@oh-my-opencode/telemetry-core/immediate-send"
// The recorder itself (windows, storage, publisher) loads here too, on a session's first turn or shutdown.
export { createSessionSummaryRecorder } from "./omo-native-session-summary"
export { createSummaryStorage } from "./session-summary-storage"
export { currentProcessOwner } from "./session-summary-owner"

/** At most this many events wait for delivery; past it the oldest are dropped and counted in `dropped_events`. */
export const PENDING_CAP = 200
/** And at most this many bytes of them. */
export const PENDING_CAP_BYTES = 1024 * 1024
/** A sweep starts at most this many re-sends; the rest wait for a later sweep. */
export const RESENDS_PER_SWEEP = 20
/** Re-sends of one event back off from one minute, doubling, up to an hour between attempts. */
export const RESEND_BACKOFF_MS = { first: 60_000, max: 60 * 60_000 } as const

/**
 * The liveness-aware half of the opt-out purge: dead owners' temps, claims and registry entries, decided by owner
 * liveness. The storage is built here, so the entry bundle never carries the storage or owner modules.
 */
export function purgeOptedOutStorage(input: {
  readonly stateDir: string
  readonly isScopeConsented: (scope: ConsentScope) => boolean
  readonly isPidAlive?: (pid: number) => boolean
}): void {
  const storage = createSummaryStorage({
    stateDir: input.stateDir,
    owner: currentProcessOwner(),
    ...(input.isPidAlive === undefined ? {} : { isPidAlive: input.isPidAlive }),
  })
  purgeOptedOutQueue({ storage: withRecoveryOps(storage), isScopeConsented: input.isScopeConsented })
}

export type SummaryRecovery = {
  /** One pass over the summary directory; safe to run concurrently from any number of processes. */
  readonly sweep: () => void
  /** Claims and publishes one dead owner's window; returns the seq its session continues from. */
  readonly recoverWindow: (key: string) => number | undefined
}

export function createSummaryRecovery(input: {
  readonly storage: RecoveryStorage
  readonly publisher: SummaryPublisher
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  /** Consent re-read for a record's originating scope before it is sent or continued; defaults to consented. */
  readonly isScopeConsented?: (scope: ConsentScope) => boolean
}): SummaryRecovery {
  const { storage, publisher } = input
  const isScopeConsented = input.isScopeConsented ?? (() => true)
  const isExpired = (at: number) => storage.now() - at > SUMMARY_TTL_MS
  const isSelf = (record: PendingRecord) =>
    record.owner.pid === storage.owner.pid && record.owner.bootId === storage.owner.bootId

  const reportCorrupt = (what: string): void => {
    input.diagnostics?.({
      event: "telemetry_activity_state_read_failed",
      source: "omo-native-session-summary",
      error: new Error(`unreadable session summary ${what} was removed`),
      errorKind: "error",
    })
  }

  // Claimable only when BOTH hold: the owner is gone (dead pid, or a pid now held by another process) and
  // its heartbeat is older than OWNER_STALE_MS. A live owner keeps its heartbeat fresh every minute.
  const isAbandoned = (record: WindowRecord) =>
    storage.now() - record.heartbeatAt > OWNER_STALE_MS && !storage.isOwnerAlive(record.owner)

  const finishClaimedWindow = (key: string, claimed: Claimed<ReadResult<WindowRecord>>): number | undefined => {
    const record = claimed.record
    if (record === undefined || record === CORRUPT) {
      removeFile(claimed.claimPath)
      if (record === CORRUPT) reportCorrupt("window")
      return undefined
    }
    // No consent mark, or its project opted out since it was written: dropped unsent (fail closed).
    if (!isRecordSendable(record, isScopeConsented)) {
      removeFile(claimed.claimPath)
      return undefined
    }
    const nextSeq = record.window === null ? record.seq : record.seq + 1
    // Published and continued under a new epoch: an owner misjudged dead that still publishes never repeats a pair.
    const epoch = newSummaryEpoch()
    // A dead process's own copy is never continued (its key names that process), so it is not recreated.
    const keepNumbering = () => {
      if (!storage.isOwnCopyKey(key)) {
        storage.createWindow(key, { ...record, owner: storage.owner, heartbeatAt: storage.now(), epoch, seq: nextSeq, windowId: null, window: null })
      }
      removeFile(claimed.claimPath)
    }
    // The pending file of this window exists when its owner died after step (1) of the publication: the
    // pending copy is the one that gets re-sent, under the same uuid, so no second window is created.
    if (record.window === null || record.windowId === null || storage.hasPending(record.windowId)) {
      keepNumbering()
      return nextSeq
    }
    void publisher.publishWindow({
      consent: record.consent,
      scope: record.scope,
      sessionHash: record.sessionHash,
      sessionRole: record.sessionRole,
      sampleRate: record.sampleRate,
      epoch,
      seq: record.seq,
      windowId: record.windowId,
      window: record.window,
      endedBy: "recovered",
    }, keepNumbering)
    return nextSeq
  }

  const recoverWindow = (key: string): number | undefined => {
    const claimed = storage.claimWindow(key)
    return claimed === undefined ? undefined : finishClaimedWindow(key, claimed)
  }

  const resendClaimedPending = (uuid: string, claimed: Claimed<ReadResult<PendingRecord>>): void => {
    const record = claimed.record
    if (record === undefined || record === CORRUPT) {
      removeFile(claimed.claimPath)
      if (record === CORRUPT) reportCorrupt("pending event")
      return
    }
    if (!isRecordSendable(record, isScopeConsented)) {
      removeFile(claimed.claimPath)
      return
    }
    // Re-owned before sending: if this process dies too, the next one resends it; while it lives, nobody does.
    storage.writePending({ ...record, owner: storage.owner })
    removeFile(claimed.claimPath)
    void publisher.deliver({ ...record, uuid })
  }

  const sweepLeftovers = (): void => {
    for (const leftover of storage.leftovers()) {
      if (storage.isOwnerAlive(leftover.owner)) continue
      if (leftover.kind === "temp") {
        removeFile(leftover.path)
        continue
      }
      const base = leftover.path.slice(0, leftover.path.lastIndexOf(".claimed-"))
      if (!renameIfPresent(leftover.path, base)) removeFile(leftover.path)
    }
  }

  // Per event: when its next re-send may start, and the delay after that. A sent event leaves the directory.
  const backoff = new Map<string, { readonly at: number; readonly delay: number }>()
  const mayResend = (uuid: string): boolean => {
    const next = backoff.get(uuid)
    return next === undefined || storage.now() >= next.at
  }
  const resendQueued = (uuid: string): void => {
    const delay = Math.min((backoff.get(uuid)?.delay ?? RESEND_BACKOFF_MS.first / 2) * 2, RESEND_BACKOFF_MS.max)
    backoff.set(uuid, { at: storage.now() + delay, delay })
  }

  // Oldest first, past either cap: a long outage cannot grow the spool without bound.
  const dropOverCap = (uuids: readonly string[]): ReadonlySet<string> => {
    const aged = uuids.map((uuid) => {
      const record: ReadResult<PendingRecord> = storage.readPending(uuid)
      const readable = record !== undefined && record !== CORRUPT ? record : undefined
      return { uuid, readable, createdAt: readable?.createdAt ?? 0, bytes: fileBytes(join(storage.dir, "pending", `${uuid}.json`)) }
    }).sort((left, right) => left.createdAt - right.createdAt)
    let files = aged.length
    let bytes = aged.reduce((total, entry) => total + entry.bytes, 0)
    const dropped = new Set<string>()
    for (const entry of aged) {
      if (files <= PENDING_CAP && bytes <= PENDING_CAP_BYTES) break
      if (publisher.isInFlight(entry.uuid)) continue
      storage.removePending(entry.uuid)
      backoff.delete(entry.uuid)
      dropped.add(entry.uuid)
      files -= 1
      bytes -= entry.bytes
      if (entry.readable !== undefined && isRecordSendable(entry.readable, isScopeConsented)) publisher.countDropped(1)
    }
    return dropped
  }

  const sweepPending = (): void => {
    const uuids = storage.pendingUuids()
    const dropped = dropOverCap(uuids)
    let resends = 0
    for (const uuid of uuids) {
      if (dropped.has(uuid)) continue
      const record = storage.readPending(uuid)
      if (record === undefined || publisher.isInFlight(uuid)) continue
      // Written by an opted-out session, or before consent marks existed: deleted unsent, never counted.
      if (record !== CORRUPT && record.consent !== "enabled") {
        storage.removePending(uuid)
        continue
      }
      if (record !== CORRUPT && isExpired(record.createdAt)) {
        storage.removePending(uuid)
        if (isRecordSendable(record, isScopeConsented)) publisher.countDropped(1)
        continue
      }
      if (record !== CORRUPT && !isSelf(record) && storage.isOwnerAlive(record.owner)) continue
      if (resends >= RESENDS_PER_SWEEP || !mayResend(uuid)) continue
      resends += 1
      resendQueued(uuid)
      if (record !== CORRUPT && isSelf(record)) {
        void publisher.deliver(record)
        continue
      }
      const claimed = storage.claimPending(uuid)
      if (claimed !== undefined) resendClaimedPending(uuid, claimed)
    }
  }

  const sweepWindows = (): void => {
    for (const key of storage.windowKeys()) {
      const record = storage.readWindow(key)
      if (record === undefined) continue
      if (record === CORRUPT) {
        const claimed = storage.claimWindow(key)
        if (claimed !== undefined) finishClaimedWindow(key, claimed)
        continue
      }
      if (record.consent !== "enabled") {
        storage.removeWindow(key)
        continue
      }
      if (isExpired(record.heartbeatAt)) {
        storage.removeWindow(key)
        // An opted-out scope's lost window is not counted either: the count would describe that scope.
        if (record.window !== null && isRecordSendable(record, isScopeConsented)) publisher.countDropped(1)
        continue
      }
      if (record.window !== null && isAbandoned(record)) recoverWindow(key)
    }
  }

  return {
    recoverWindow,
    sweep() {
      sweepLeftovers()
      sweepPending()
      sweepWindows()
    },
  }
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export type RecoveryRuntime = {
  readonly sweep: () => void
  /** Continues another process's window for this session (see `adoptForeignWindow`). */
  readonly adopt: (input: Omit<Parameters<typeof adoptForeignWindow>[0], "storage">) => LiveWindow
}

/** The recorder's whole recovery side, built once on the first sidecar load. */
export function createRecoveryRuntime(input: {
  readonly storage: SummaryStorage
  readonly publisher: SummaryPublisher
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly isScopeConsented?: (scope: ConsentScope) => boolean
}): RecoveryRuntime {
  const storage = withRecoveryOps(input.storage)
  return {
    sweep: createSummaryRecovery({ ...input, storage }).sweep,
    adopt: (args) => adoptForeignWindow({ storage, ...args }),
  }
}
