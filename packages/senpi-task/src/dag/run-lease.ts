// Who holds a DAG run: the durable lease a scheduler records, and the evidence that stands in for it
// on a checkpoint written before every scheduler recorded one.
import { defaultSignaller } from "../lifecycle/context"
import {
  observeRecordOwners,
  ownerProcessViewFor,
  recordOwnerAlive,
  type OwnerProcessView,
} from "../lifecycle/owner-process"
import { isTerminalRecord } from "../manager/manager-helpers"
import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import type { HostClaim } from "../state/record-types"
import type { DagRunRecordV1 } from "./manager"
import type { DagFileStore } from "./store"
import { TERMINAL_DAG_RUN_STATUSES, type DagNode, type DagNodeId, type DagRunEvent, type DagRunId } from "./types"

export type DagRunHolderProbe = {
  readonly taskManager: Pick<TaskManager, "get" | "findOwnedTask">
  readonly hostPid: number
  readonly isProcessAlive: (pid: number) => boolean
  // The start evidence a child's owner is judged by (the lifecycle's own `recordOwnerAlive`); absent,
  // or never observed for the pid, the pid alone answers, as it does for a record with no stamp.
  readonly ownerProcesses?: OwnerProcessView
}

/** A holder: a lease names a bare pid; a node's child names its owner with that owner's claim. */
export type DagRunHolder = { readonly pid: number; readonly claim?: HostClaim }

type LeasedRecord = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }
type LeaseStore = Pick<DagFileStore, "withRunLock" | "readCheckpoint" | "writeCheckpoint">
type OwnerLivenessOptions = {
  readonly isProcessAlive?: (pid: number) => boolean
  readonly ownerProcesses?: OwnerProcessView
}

/**
 * The one way a DAG caller judges a recorded owner: signal-0, and the start view the lifecycle uses
 * (an injected probe without its own view learns nothing from the OS, exactly as in the lifecycle).
 */
export function ownerLiveness(options: OwnerLivenessOptions) {
  return {
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
    ownerProcesses: ownerProcessViewFor(options.isProcessAlive, options.ownerProcesses),
  }
}

export function holderProbeOf(
  options: OwnerLivenessOptions & Pick<DagRunHolderProbe, "taskManager"> & { readonly hostPid?: number },
): DagRunHolderProbe {
  return { taskManager: options.taskManager, hostPid: options.hostPid ?? process.pid, ...ownerLiveness(options) }
}

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

// The unfinished current child of every active node: an ended child holds nothing even though its
// resident record keeps the pid of the host that ran it.
function activeChildren(probe: DagRunHolderProbe, record: DagRunRecordV1): TaskRecord[] {
  return record.nodes.flatMap((node) => {
    if (node.state !== "scheduled" && node.state !== "running") return []
    const task = currentNodeTask(probe.taskManager, record, node)
    return task === undefined || isTerminalRecord(task) ? [] : [task]
  })
}

// A run checkpointed before schedulers recorded a lease names no holder, so the process that still
// owns its active children stands in for it. Lifecycle reconcile runs first and takes over the
// children of a dead owner, so a child still under a live foreign owner means that process runs it.
// The owner is judged as the lifecycle judges it: a pid now held by a process whose start contradicts
// the claim's stamp owns nothing, even while a reconcile that could not take the claim left it there.
export function liveChildOwner(probe: DagRunHolderProbe, record: DagRunRecordV1): DagRunHolder | undefined {
  const view = probe.ownerProcesses ?? ownerProcessViewFor(probe.isProcessAlive, undefined)
  for (const task of activeChildren(probe, record)) {
    const pid = task.host_pid
    if (pid === undefined || pid === probe.hostPid || !recordOwnerAlive(probe.isProcessAlive, view, task)) continue
    return task.host_claim?.pid === pid && task.host_claim.start !== undefined
      ? { pid, claim: task.host_claim }
      : { pid }
  }
  return undefined
}

/**
 * Reads the start of every stamped foreign owner of the record's active children, so the holder rule
 * decided right after it can tell a reused pid from its owner. Every entry that can await calls it
 * before deciding (recovery's claim, the controls, cancel, Stop); undefined when nothing needs reading.
 */
export function observeChildOwners(probe: DagRunHolderProbe, record: DagRunRecordV1 | null): Promise<void> | undefined {
  if (record === null || probe.ownerProcesses === undefined) return undefined
  return observeRecordOwners(probe.ownerProcesses, activeChildren(probe, record), probe.hostPid)
}

/**
 * The one answer to "who holds this run": its lease, else the host that paused it for shutdown and
 * may still be draining, else (for a record naming neither) the live owner of an active child. The
 * claim, the unheld cancel and the shutdown pause all ask this (#15125). The lease and the previous
 * holder are bare pids on the run record, with no start stamp, so a pid alone answers for them.
 */
export function runHolder(probe: DagRunHolderProbe, record: LeasedRecord): DagRunHolder | undefined {
  const leased = record.leaseHolderPid ?? record.previousLeaseHolderPid
  return leased === undefined ? liveChildOwner(probe, record) : { pid: leased }
}

export function liveForeignHolderOf(probe: DagRunHolderProbe, record: LeasedRecord): DagRunHolder | undefined {
  const holder = runHolder(probe, record)
  return holder !== undefined && holder.pid !== probe.hostPid && probe.isProcessAlive(holder.pid) ? holder : undefined
}

export function liveForeignHolder(probe: DagRunHolderProbe, record: LeasedRecord): number | undefined {
  return liveForeignHolderOf(probe, record)?.pid
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
  // A send that revived a child of a settled run held the run for it; the fold of the last such
  // child's outcome is the write that ends that holding.
  if (event.type === "dag.node.transitioned" && event.from === "running") {
    if (record.leaseHolderPid === undefined || !TERMINAL_DAG_RUN_STATUSES.has(record.status)) return record
    if (record.nodes.some((node) => node.state === "running" || node.state === "scheduled")) return record
    const { leaseHolderPid: _lease, ...released } = record
    return released
  }
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
