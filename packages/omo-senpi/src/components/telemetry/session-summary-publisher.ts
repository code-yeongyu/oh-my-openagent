import type { EventTelemetryProperties, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import type { sendSummaryRecord, SummaryPublish } from "./session-summary-delivery"

import type { TelemetrySessionRole } from "./session-role"
import { isRecordSendable, type ConsentScope, type PendingRecord, type RecordConsent, type SummaryStorage } from "./session-summary-storage"
import { summaryProperties, type EndedBy, type SummaryWindow } from "./session-summary-window"
import { isSessionSampled } from "./session-summary-sampling"

/** `timestamp` is the window's close time (the pending record's createdAt), the same on every re-send. */
export type SummaryPublication = { readonly uuid: string; readonly properties: EventTelemetryProperties; readonly timestamp: number }

/**
 * Resolves true only when the transport acknowledged the event (a 2xx answer). A rejection keeps the pending
 * file for a later retry, unless it is a permanent `TelemetryDeliveryError` (the event itself was refused).
 */
export type PublishSummary = (publication: SummaryPublication) => Promise<boolean>

export type ClosedWindow = {
  readonly consent: RecordConsent
  readonly scope: ConsentScope | undefined
  readonly sessionHash: string
  readonly sessionRole: TelemetrySessionRole
  readonly sampleRate: number
  readonly epoch: string
  readonly seq: number
  readonly windowId: string
  readonly window: SummaryWindow
  readonly endedBy: EndedBy
}

export type SummaryPublisher = {
  /**
   * The publication protocol, in this order: (1) the exact event lands in `pending/<window_id>.json`,
   * (2) `advanceSeq` persists the next sequence, (3) the event is published, (4) the pending file is deleted
   * only on acknowledgment. A crash before (1) leaves the window for recovery; a crash after (1) leaves a
   * pending file that is re-sent with the same uuid, so the window is never published under two ids.
   */
  readonly publishWindow: (closed: ClosedWindow, advanceSeq: () => void) => Promise<void>
  readonly deliver: (record: PendingRecord) => Promise<void>
  readonly isInFlight: (uuid: string) => boolean
  readonly countDropped: (count: number) => void
  /** The summary's one diagnostic path, shared with the recorder. */
  readonly report: (event: TelemetryDiagnosticInput["event"], error: unknown) => void
  /** Resolves once every delivery started so far has been acknowledged or given up. */
  readonly settled: () => Promise<void>
}

/** Loads the send step; the recorder passes the recovery sidecar, so a run that never closes a window skips it. */
export type LoadSummaryDelivery = () => Promise<{ readonly sendSummaryRecord: typeof sendSummaryRecord }>

export function createSummaryPublisher(input: {
  readonly storage: SummaryStorage
  readonly publish: SummaryPublish
  readonly loadDelivery: LoadSummaryDelivery
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly transportDropped?: () => number
  /** Consent for the scope a record came from, read now; defaults to consented. */
  readonly isScopeConsented?: (scope: ConsentScope) => boolean
}): SummaryPublisher {
  const isScopeConsented = input.isScopeConsented ?? (() => true)
  const inFlight = new Set<string>()
  const running = new Set<Promise<void>>()
  let dropped = 0

  const report = (event: TelemetryDiagnosticInput["event"], error: unknown): void => {
    input.diagnostics?.({
      event,
      source: "omo-native-session-summary",
      error: error instanceof Error ? error : new Error(String(error)),
      errorKind: error instanceof Error ? "error" : "non_error",
    })
  }

  const takeDropped = (): number => {
    const total = dropped + (input.transportDropped?.() ?? 0)
    dropped = 0
    return total
  }

  const countDropped = (count: number): void => {
    dropped += count
  }

  // A failed load keeps the pending file, exactly like a failed send, and the next delivery loads again.
  const send = async (record: PendingRecord): Promise<void> => {
    try {
      const { sendSummaryRecord } = await input.loadDelivery()
      await sendSummaryRecord(record, { storage: input.storage, publish: input.publish, report, countDropped })
    } catch (error) {
      report("telemetry_capture_failed", error)
    } finally {
      inFlight.delete(record.uuid)
    }
  }

  const deliver = (record: PendingRecord): Promise<void> => {
    // The one place an event leaves for the transport: a record without the consent mark, or whose
    // originating scope has opted out since it was written, is deleted, never sent.
    if (!isRecordSendable(record, isScopeConsented)) {
      input.storage.removePending(record.uuid)
      return Promise.resolve()
    }
    if (inFlight.has(record.uuid)) return Promise.resolve()
    inFlight.add(record.uuid)
    const delivery = send(record)
    running.add(delivery)
    void delivery.finally(() => running.delete(delivery))
    return delivery
  }

  return {
    deliver,
    report,
    isInFlight: (uuid) => inFlight.has(uuid),
    settled: async () => {
      await Promise.all([...running])
    },
    countDropped,
    async publishWindow(closed, advanceSeq) {
      if (closed.consent !== "enabled") return
      const record: PendingRecord = {
        consent: closed.consent,
        scope: closed.scope,
        uuid: closed.windowId,
        sessionHash: closed.sessionHash,
        owner: input.storage.owner,
        createdAt: input.storage.now(),
        properties: summaryProperties(closed.sessionHash, closed.window, {
          endedBy: closed.endedBy,
          epoch: closed.epoch,
          seq: closed.seq,
          sampleRate: closed.sampleRate,
          sampled: isSessionSampled(closed.sessionHash, closed.sampleRate),
          sessionRole: closed.sessionRole,
          droppedEvents: takeDropped(),
        }),
      }
      try {
        input.storage.writePending(record)
      } catch (error) {
        report("telemetry_activity_state_write_failed", error)
      }
      try {
        advanceSeq()
      } catch (error) {
        report("telemetry_activity_state_write_failed", error)
      }
      await deliver(record)
    },
  }
}
