import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import { CORRUPT, removeFile, renameIfPresent } from "./session-summary-files"
import type { SummaryPublisher } from "./session-summary-publisher"
import type { LiveWindow } from "./omo-native-session-summary"
import { adoptForeignWindow } from "./session-summary-adopt"
import { withRecoveryOps, type RecoveryStorage } from "./session-summary-recovery-storage"
import { newSummaryEpoch } from "./session-summary-window"
import {
  OWNER_STALE_MS,
  SUMMARY_TTL_MS,
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

  const sweepPending = (): void => {
    for (const uuid of storage.pendingUuids()) {
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
      if (record !== CORRUPT && isSelf(record)) {
        void publisher.deliver(record)
        continue
      }
      if (record !== CORRUPT && storage.isOwnerAlive(record.owner)) continue
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
