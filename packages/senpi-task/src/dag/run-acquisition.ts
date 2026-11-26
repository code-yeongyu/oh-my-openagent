// The one way this host takes a run (#15125). Every entry that makes this host schedule or mutate a
// run (a fresh start, a retry or amend re-entry, a recovery claim, an unheld cancel) acquires it
// here: on the FRESH checkpoint under the run lock it (1) checks the caller's eligibility, (2) asks
// the one holder rule, (3) takes this process's per-run reservation and (4) writes the lease. The
// caller then builds its scheduler or journal from the returned record, never from an earlier read.
import type { DagRunRecordV1 } from "./manager"
import { liveForeignHolder, type DagRunHolderProbe } from "./run-lease"
import type { DagFileStore } from "./store"
import type { DagRunId } from "./types"

/** This process's claim on one run while an operation installs, re-enters or mutates it. */
export type DagRunReservation = {
  readonly runId: DagRunId
  readonly operation: string
  readonly release: () => void
}

export type DagRunReservations = {
  /** Undefined when another operation of this process already holds the run. */
  readonly reserve: (runId: DagRunId, operation: string) => DagRunReservation | undefined
  readonly inFlight: (runId: DagRunId) => string | undefined
  readonly whenFree: (runId: DagRunId) => Promise<void>
  readonly whenAllFree: () => Promise<void>
}

export function createDagRunReservations(): DagRunReservations {
  const held = new Map<DagRunId, { readonly operation: string; readonly released: Promise<void> }>()
  return {
    reserve(runId, operation) {
      if (held.has(runId)) return undefined
      let markReleased = (): void => undefined
      const entry = { operation, released: new Promise<void>((resolve) => (markReleased = resolve)) }
      held.set(runId, entry)
      let open = true
      return {
        runId,
        operation,
        release: () => {
          if (!open) return
          open = false
          if (held.get(runId) === entry) held.delete(runId)
          markReleased()
        },
      }
    },
    inFlight: (runId) => held.get(runId)?.operation,
    whenFree: (runId) => held.get(runId)?.released ?? Promise.resolve(),
    whenAllFree: async () => {
      while (held.size > 0) await Promise.all([...held.values()].map((entry) => entry.released))
    },
  }
}

type LeasedRecord = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }

export type DagRunAcquisition<T extends LeasedRecord> =
  | { readonly kind: "acquired"; readonly record: T; readonly reservation: DagRunReservation | undefined }
  | { readonly kind: "not_eligible"; readonly record: T }
  | { readonly kind: "held"; readonly holderPid: number }
  | { readonly kind: "busy"; readonly operation: string }
  | { readonly kind: "missing" }

export type DagRunAcquisitionRequest<T extends LeasedRecord> = {
  readonly operation: string
  /** What this entry expects of the fresh record: its statuses and its parent session. */
  readonly eligible: (fresh: T) => boolean
  readonly probe: DagRunHolderProbe
  readonly reservations?: DagRunReservations
  /** A reservation the caller already holds for this run (an operation spanning several steps). */
  readonly reservation?: DagRunReservation
  /** A stricter holder rule than `liveForeignHolder` (the fork-source adoption). */
  readonly holder?: (fresh: T) => number | undefined
  /** Fields written together with the lease (the fork-source adoption re-homes the run). */
  readonly claim?: (fresh: T) => T
}

/**
 * The acquisition's decision on a fresh record, without taking anything: is it eligible for the
 * caller, and does a live process other than this one hold it. Callers evaluate it while holding the
 * run lock on the record they will write (`acquireDagRun`, or a journal's locked `skipDuplicate` for an
 * entry such as Stop that writes without taking the lease).
 */
export function decideDagRun<T extends LeasedRecord>(
  fresh: T,
  request: Pick<DagRunAcquisitionRequest<T>, "eligible" | "probe" | "holder">,
):
  | { readonly kind: "not_eligible" }
  | { readonly kind: "held"; readonly holderPid: number }
  | { readonly kind: "free" } {
  if (!request.eligible(fresh)) return { kind: "not_eligible" }
  const holderPid = request.holder === undefined ? liveForeignHolder(request.probe, fresh) : request.holder(fresh)
  return holderPid === undefined ? { kind: "free" } : { kind: "held", holderPid }
}

export function acquireDagRun<T extends LeasedRecord>(
  store: Pick<DagFileStore, "withRunLock" | "readCheckpoint" | "writeCheckpoint">,
  runId: DagRunId,
  request: DagRunAcquisitionRequest<T>,
): DagRunAcquisition<T> {
  return store.withRunLock(runId, () => {
    const fresh = store.readCheckpoint<T>(runId)
    if (fresh === null) return { kind: "missing" }
    const decision = decideDagRun(fresh, request)
    if (decision.kind === "not_eligible") return { kind: "not_eligible", record: fresh }
    if (decision.kind === "held") return decision
    let reservation = request.reservation
    if (reservation === undefined && request.reservations !== undefined) {
      reservation = request.reservations.reserve(runId, request.operation)
      if (reservation === undefined)
        return { kind: "busy", operation: request.reservations.inFlight(runId) ?? request.operation }
    }
    const claimed = request.claim?.(fresh) ?? fresh
    if (claimed === fresh && fresh.leaseHolderPid === request.probe.hostPid)
      return { kind: "acquired", record: fresh, reservation }
    const record = { ...claimed, leaseHolderPid: request.probe.hostPid }
    store.writeCheckpoint(runId, record)
    return { kind: "acquired", record, reservation }
  })
}
