// Who holds a DAG run: the durable lease a scheduler records, and the evidence that stands in for it
// on a checkpoint written before every scheduler recorded one.
import { isTerminalRecord } from "../manager/manager-helpers"
import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import type { DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

export type DagRunHolderProbe = {
  readonly taskManager: Pick<TaskManager, "get" | "findOwnedTask">
  readonly hostPid: number
  readonly isProcessAlive: (pid: number) => boolean
}

type LeasedRecord = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }
type LeaseStore = Pick<DagFileStore, "withRunLock" | "readCheckpoint" | "writeCheckpoint">

export function ownerKey(record: DagRunRecordV1, nodeId: DagNodeId) {
  return { kind: "dag" as const, runId: record.runId, nodeId }
}

// A node's current child: retrying retains the checkpoint's taskId until the next admission batch
// attaches its replacement, and an admitted child exists before that batch commits, so the newest
// owned task is authoritative and the checkpoint's taskId is only the fallback.
export function currentNodeTask(
  taskManager: Pick<TaskManager, "get" | "findOwnedTask">,
  record: DagRunRecordV1,
  node: Pick<DagNode, "id" | "taskId">,
): TaskRecord | undefined {
  return (
    taskManager.findOwnedTask(ownerKey(record, node.id)) ??
    (node.taskId === undefined ? undefined : taskManager.get(node.taskId))
  )
}

// A run checkpointed before schedulers recorded a lease names no holder, so the process that still
// owns its active children stands in for it. Lifecycle reconcile runs first and takes over the
// children of a dead owner, so a child still under a live foreign pid means that process runs it.
// An ended child holds nothing even though its resident record keeps the pid of the host that ran it.
export function liveChildOwner(probe: DagRunHolderProbe, record: DagRunRecordV1): number | undefined {
  for (const node of record.nodes) {
    if (node.state !== "scheduled" && node.state !== "running") continue
    const task = currentNodeTask(probe.taskManager, record, node)
    if (task === undefined || isTerminalRecord(task)) continue
    const owner = task.host_pid
    if (owner !== undefined && owner !== probe.hostPid && probe.isProcessAlive(owner)) return owner
  }
  return undefined
}

/**
 * The one answer to "who holds this run": its lease, else the host that paused it for shutdown and
 * may still be draining, else (for a record naming neither) the live owner of an active child. The
 * claim, the unheld cancel and the shutdown pause all ask this (#15125).
 */
export function runHolder(probe: DagRunHolderProbe, record: LeasedRecord): number | undefined {
  return record.leaseHolderPid ?? record.previousLeaseHolderPid ?? liveChildOwner(probe, record)
}

export function liveForeignHolder(probe: DagRunHolderProbe, record: LeasedRecord): number | undefined {
  const holder = runHolder(probe, record)
  return holder !== undefined && holder !== probe.hostPid && probe.isProcessAlive(holder) ? holder : undefined
}

export function releaseDagRunLease(store: LeaseStore, runId: DagRunId, hostPid: number): void {
  store.withRunLock(runId, () => {
    const fresh = store.readCheckpoint<LeasedRecord>(runId)
    if (fresh === null || fresh.leaseHolderPid !== hostPid) return
    const { leaseHolderPid: _leaseHolderPid, previousLeaseHolderPid: _previousLeaseHolderPid, ...released } = fresh
    store.writeCheckpoint(runId, released)
  })
}

/**
 * The lease leaves the record in the same write that ends this host's holding, never before it: a
 * terminal status, a park or a user Stop drops it, and the shutdown pause hands it over as
 * `previousLeaseHolderPid`. A scheduler merely retired while its run is still `running` keeps it,
 * so no other process can read that interval as an abandoned run (#15125).
 */
export function leaseAfterEvent(record: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 {
  if (event.type === "dag.run.paused") {
    if (record.leaseHolderPid === undefined) return record
    const { leaseHolderPid, previousLeaseHolderPid: _previous, ...released } = record
    return event.reason === "session_shutdown" ? { ...released, previousLeaseHolderPid: leaseHolderPid } : released
  }
  if (event.type !== "dag.run.completed" && event.type !== "dag.run.failed" && event.type !== "dag.run.cancelled")
    return record
  const { leaseHolderPid: _lease, previousLeaseHolderPid: _previous, ...released } = record
  return released
}
