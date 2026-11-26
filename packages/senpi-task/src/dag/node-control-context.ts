// The shared boundary of the per-node control verbs: one refusal vocabulary, one ownership/lease
// check, and one journal factory, so retry and send can never disagree about who owns a run.
import { defaultSignaller } from "../lifecycle/context"
import { createDagJournal, type DagJournal } from "./journal"
import { skipDuplicateTerminalTransition, type DagRunRecordV1 } from "./manager"
import { releaseDagRunLease, takeDagRunLease } from "./run-lease"
import { applyDagSchedulerEvent, type DagSchedulerOptions } from "./scheduler"
import type { DagFileStore } from "./store"
import type { DagNodeError, DagNodeId, DagRunId } from "./types"

export const DAG_NODE_CONTROL_ERROR_CODES = [
  "run_not_found",
  "run_not_owned",
  "run_still_active",
  "invalid_arguments",
  "node_not_found",
  "node_not_retryable",
  "node_has_no_task",
  "node_not_continuable",
  "node_unresponsive",
  "run_paused_by_user",
  "run_not_user_paused",
] as const

export type DagNodeControlErrorCode = (typeof DAG_NODE_CONTROL_ERROR_CODES)[number]

/**
 * Every refusal the per-node control verbs produce. `code` is the wire vocabulary the dag tool
 * surfaces verbatim; `nodeIds` names the exact nodes that caused the refusal.
 */
export class DagNodeControlError extends Error {
  readonly code: DagNodeControlErrorCode
  readonly runId?: DagRunId
  readonly nodeIds: readonly DagNodeId[]

  constructor(input: {
    readonly code: DagNodeControlErrorCode
    readonly message: string
    readonly runId?: DagRunId
    readonly nodeIds?: readonly DagNodeId[]
  }) {
    super(input.message)
    this.name = "DagNodeControlError"
    this.code = input.code
    if (input.runId !== undefined) this.runId = input.runId
    this.nodeIds = input.nodeIds ?? []
  }
}

/**
 * The run a control verb is allowed to touch: it must be this scheduler's run, it must still exist,
 * and no OTHER live process may hold its lease.
 */
export function ownedRecord(options: DagSchedulerOptions, runId: DagRunId): DagRunRecordV1 {
  if (runId !== options.initialRecord.runId) {
    throw new DagNodeControlError({
      code: "run_not_owned",
      message: `dag run "${runId}" is not owned by this scheduler`,
      runId,
    })
  }
  const record = readRecord(options.store, runId)
  if (record === null) {
    throw new DagNodeControlError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
  }
  const hostPid = options.hostPid ?? process.pid
  const isAlive = options.isProcessAlive ?? defaultSignaller.isAlive
  const leaseHolderPid = (record as DagRunRecordV1 & { readonly leaseHolderPid?: number }).leaseHolderPid
  if (leaseHolderPid !== undefined && leaseHolderPid !== hostPid && isAlive(leaseHolderPid)) {
    throw new DagNodeControlError({
      code: "run_not_owned",
      message: `dag run "${runId}" is leased by live process ${leaseHolderPid}`,
      runId,
    })
  }
  return record
}

/**
 * A run paused for any reason but the user's Stop that still records active nodes has children no
 * scheduler holds (a parked run, #15125). Only recovery may reattach them; a control verb that built
 * another scheduler over them would hold none of them either.
 */
export function refuseUnheldActiveNodes(record: DagRunRecordV1): void {
  if (record.status !== "paused" || record.pause?.reason === "user_stop") return
  const active = record.nodes.filter((node) => node.state === "scheduled" || node.state === "running")
  if (active.length === 0) return
  throw new DagNodeControlError({
    code: "run_still_active",
    message: `dag run "${record.runId}" has active nodes whose children no scheduler holds; recovery must reattach them first`,
    runId: record.runId,
    nodeIds: active.map((node) => node.id),
  })
}

/**
 * Takes the run's lease for a re-entry (retry, amend) before its first write, so no other process can
 * claim the run this host is about to revive and no child starts under another live process's lease
 * (#15125). Refuses with `run_not_owned` while another live process holds the lease. Returns the
 * release for a re-entry that fails before its scheduler takes over.
 */
export function acquireReentryLease(options: DagSchedulerOptions, runId: DagRunId): () => void {
  const probe = {
    taskManager: options.taskManager,
    hostPid: options.hostPid ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
  }
  const heldBefore = readRecord(options.store, runId)?.leaseHolderPid === probe.hostPid
  const take = takeDagRunLease(options.store, runId, probe)
  if (take.kind === "missing") {
    throw new DagNodeControlError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
  }
  if (take.kind === "held") {
    throw new DagNodeControlError({
      code: "run_not_owned",
      message: `dag run "${runId}" is held by live process ${take.holderPid}`,
      runId,
    })
  }
  return heldBefore ? () => undefined : () => releaseDagRunLease(options.store, runId, probe.hostPid)
}

export function readRecord(store: DagFileStore, runId: DagRunId): DagRunRecordV1 | null {
  return store.readCheckpoint<DagRunRecordV1>(runId)
}

export function currentRecord(options: DagSchedulerOptions, runId: DagRunId): DagRunRecordV1 {
  return readRecord(options.store, runId) ?? options.initialRecord
}

/**
 * A journal for control-verb writes. It is a SEPARATE instance from the settled scheduler's journal
 * on purpose: it recovers the current checkpoint on construction, so it always writes on top of the
 * durable record rather than a stale in-memory snapshot.
 */
export function controlJournal(
  options: DagSchedulerOptions,
  record: DagRunRecordV1,
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError> = new Map(),
): DagJournal<DagRunRecordV1> {
  const now = options.now ?? Date.now
  return createDagJournal<DagRunRecordV1>({
    store: options.store,
    runId: record.runId,
    initialCheckpoint: record,
    applyEvent: (checkpoint, event) =>
      applyDagSchedulerEvent(checkpoint, event, pendingErrors, {
        store: options.store,
        pendingTerminalResults: new Map(),
        now,
      }),
    ...(options.subscriberRing === undefined ? {} : { subscriberRing: options.subscriberRing }),
    now,
    skipDuplicate: skipDuplicateTerminalTransition,
  })
}

export function controlErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
