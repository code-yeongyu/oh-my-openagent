// The one way this host takes a run (#15125). Every entry that makes this host schedule or mutate a
// run (a fresh start, a retry or amend re-entry, a recovery claim, an unheld cancel) acquires it
// here: on the FRESH checkpoint under the run lock it (1) checks the caller's eligibility, (2) asks
// the one holder rule, (3) takes this process's per-run reservation and (4) writes the lease. The
// caller then builds its scheduler or journal from the returned record, never from an earlier read.
import type { DagRunRecordV1 } from "./manager"
import { liveForeignHolder, type DagRunHolderProbe } from "./run-lease"
import type { DagFileStore } from "./store"
import { TERMINAL_DAG_RUN_STATUSES, type DagRunId } from "./types"

export {
  createDagRunReservations,
  reserveWhenFree,
  type DagRunHeldReservations,
  type DagRunReservation,
  type DagRunReservations,
} from "./run-reservations"
import type { DagRunReservation, DagRunReservations } from "./run-reservations"

type LeasedRecord = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }
type Eligibility = (fresh: LeasedRecord) => boolean

const LIVE_STATUSES = new Set(["pending", "running"])
const STOPPABLE_STATUSES = new Set(["pending", "running", "paused"])
const hasActiveNode = (record: LeasedRecord): boolean =>
  record.nodes.some((node) => node.state === "scheduled" || node.state === "running")
const stoppedByUser = (record: LeasedRecord): boolean => record.pause?.reason === "user_stop"

/**
 * Each entry's complete eligibility, decided on the fresh record under the run lock (#15125). An
 * entry passes exactly one of these to `acquireDagRun` / `decideDagRun`; a pre-check outside the lock
 * is only ever a fast path whose answer this re-decides.
 */
export const dagRunEligibility = {
  /** A fresh start: still `pending`, of this session. */
  freshStart:
    (parentSessionId: string): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId && fresh.status === "pending",
  /**
   * A retry or amend re-entry: of this session, with NO active node (a node revived by a send keeps
   * running on a settled run until its fold), and settled or paused not by the user.
   */
  reentry:
    (parentSessionId: string): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId &&
      !hasActiveNode(fresh) &&
      (TERMINAL_DAG_RUN_STATUSES.has(fresh.status) || (fresh.status === "paused" && !stoppedByUser(fresh))),
  /**
   * Automatic recovery (session start, lease-watch re-sweep): of this session; paused but never by the
   * user and not held by a scheduler here, or left `running` with no scheduler here.
   */
  automaticRecovery:
    (parentSessionId: string, heldHere: () => boolean | undefined): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId &&
      ((fresh.status === "paused" && !stoppedByUser(fresh) && heldHere() !== true) ||
        (fresh.status === "running" && heldHere() === false)),
  /** A fork adopting its immediate source's run: paused but never by the user, with a recorded holder. */
  forkSourceAdoption:
    (sourceSessionId: string): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === sourceSessionId &&
      fresh.status === "paused" &&
      !stoppedByUser(fresh) &&
      (fresh.leaseHolderPid ?? fresh.previousLeaseHolderPid) !== undefined,
  /** The user's Resume: of this session, paused by exactly the Stop being resumed, not held here. */
  userResume:
    (parentSessionId: string, pauseSeq: number, heldHere: () => boolean | undefined): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId &&
      fresh.status === "paused" &&
      stoppedByUser(fresh) &&
      fresh.pause?.pauseSeq === pauseSeq &&
      heldHere() !== true,
  /**
   * Cancel of a run no scheduler here holds: of this session. A settled one is eligible too, because a
   * child it owns can still be live (#11381); the cancel then only drains it and writes no lease.
   */
  unheldCancel:
    (parentSessionId: string): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId,
  /** Parking a run whose scheduler here failed: of this session, still `running`, no scheduler here holds it. */
  parkFailed:
    (parentSessionId: string, heldHere: () => boolean): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId && fresh.status === "running" && !heldHere(),
  /** The shutdown pause: of this session, still live, not stopped by the user. */
  shutdownPause:
    (parentSessionId: string): Eligibility =>
    (fresh) =>
      fresh.parentSessionId === parentSessionId && LIVE_STATUSES.has(fresh.status) && !stoppedByUser(fresh),
  /** A send that reaches the child: steer into a live run, or revive (and take) a failed one. */
  send:
    (parentSessionId: string, nodeId: string): Eligibility =>
    (fresh) => {
      const decision = classifySend(fresh, parentSessionId, nodeId)
      return decision === "steer" || decision === "revive"
    },
  /** A write to a user-stopped run (guidance, node cancel, staging, delivery): still under that exact Stop. */
  stoppedWrite:
    (pauseSeq: number | undefined): Eligibility =>
    (fresh) =>
      fresh.status === "paused" && stoppedByUser(fresh) && fresh.pause?.pauseSeq === pauseSeq,
  /** The user's Stop: live or paused, not already under this Stop or a newer one. */
  userStop:
    (pauseSeq: number): Eligibility =>
    (fresh) =>
      STOPPABLE_STATUSES.has(fresh.status) && (fresh.pause?.pauseSeq ?? 0) < pauseSeq,
} as const

export type DagRunAcquisition<T extends LeasedRecord> =
  | {
      readonly kind: "acquired"
      readonly record: T
      readonly reservation: DagRunReservation | undefined
      // True when this acquisition wrote the lease; false when this host already held it.
      readonly leaseTaken: boolean
    }
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
  /** Whether this acquisition writes the lease (default: always); a send that only steers takes none. */
  readonly leaseWhen?: (fresh: T) => boolean
  /** Fields written together with the lease (the fork-source adoption re-homes the run). */
  readonly claim?: (fresh: T) => T
}

/**
 * The acquisition's decision on a fresh record, without taking anything: is it eligible for the
 * caller, and does a live process other than this one hold it. Callers evaluate it while holding the
 * run lock on the record they will write (`acquireDagRun`, or a journal's locked `skipDuplicate` for an
 * entry such as Stop that writes without taking the lease).
 */
/**
 * The closed classification of a send on one fresh record (#15125): `guidance` (the user stopped the
 * run), `steer` (a live run, no lease), `revive` (a failed run, taken with a lease), or the reason it
 * is refused. Only steer and revive may reach the child; the holder rule is the acquisition's.
 */
export type DagSendClass =
  "guidance" | "steer" | "revive" | "other_session" | "completed" | "cancelled" | "node_not_found" | "node_has_no_task"

export function classifySend(fresh: LeasedRecord, parentSessionId: string, nodeId: string): DagSendClass {
  if (fresh.parentSessionId !== parentSessionId) return "other_session"
  const node = fresh.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) return "node_not_found"
  if (fresh.status === "paused" && stoppedByUser(fresh)) return "guidance"
  if (fresh.status === "completed" || fresh.status === "cancelled") return fresh.status
  if (node.taskId === undefined) return "node_has_no_task"
  return fresh.status === "failed" ? "revive" : "steer"
}

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
    if (request.reservation !== undefined || request.reservations === undefined)
      return writeLease(store, runId, fresh, request, request.reservation)
    const own = request.reservations.reserve(runId, request.operation)
    if (own === undefined) return { kind: "busy", operation: request.reservations.inFlight(runId) ?? request.operation }
    // The caller only receives a reservation this function created once the lease is written; on any
    // failure before that nobody else could release it, so it is released here. A caller-owned one
    // (`request.reservation`) is never released here.
    try {
      return writeLease(store, runId, fresh, request, own)
    } catch (error) {
      own.release()
      throw error
    }
  })
}

function writeLease<T extends LeasedRecord>(
  store: Pick<DagFileStore, "writeCheckpoint">,
  runId: DagRunId,
  fresh: T,
  request: DagRunAcquisitionRequest<T>,
  reservation: DagRunReservation | undefined,
): DagRunAcquisition<T> {
  const claimed = request.claim?.(fresh) ?? fresh
  if (request.leaseWhen?.(fresh) === false) return { kind: "acquired", record: fresh, reservation, leaseTaken: false }
  if (claimed === fresh && fresh.leaseHolderPid === request.probe.hostPid)
    return { kind: "acquired", record: fresh, reservation, leaseTaken: false }
  const record = { ...claimed, leaseHolderPid: request.probe.hostPid }
  store.writeCheckpoint(runId, record)
  return { kind: "acquired", record, reservation, leaseTaken: fresh.leaseHolderPid !== request.probe.hostPid }
}
