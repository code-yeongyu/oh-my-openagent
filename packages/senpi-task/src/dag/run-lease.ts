// Who holds a DAG run: the durable lease a scheduler records, and the evidence that stands in for it
// on a checkpoint written before every scheduler recorded one.
import type { TaskManager } from "../manager/types"
import type { DagRunRecordV1 } from "./manager"
import type { DagFileStore } from "./store"
import type { DagNodeId, DagRunId } from "./types"

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

// A first-generation run records no lease, so the process that still owns its attached children
// stands in for the holder. Lifecycle reconcile runs first and takes over the children of a dead
// owner, so a record still under a live foreign pid means that process is running them.
export function liveChildOwner(probe: DagRunHolderProbe, record: DagRunRecordV1): number | undefined {
  for (const node of record.nodes) {
    if (node.taskId === undefined || (node.state !== "scheduled" && node.state !== "running")) continue
    const owner = probe.taskManager.get(node.taskId)?.host_pid
    if (owner !== undefined && owner !== probe.hostPid && probe.isProcessAlive(owner)) return owner
  }
  return undefined
}

export function liveForeignHolder(probe: DagRunHolderProbe, record: LeasedRecord): number | undefined {
  const holder = record.leaseHolderPid ?? liveChildOwner(probe, record)
  return holder !== undefined && holder !== probe.hostPid && probe.isProcessAlive(holder) ? holder : undefined
}

/**
 * Records this process as the run's holder before a scheduler admits anything, so no other process
 * can read the run as abandoned while it waits for its first child (#15125). Refuses (undefined) a
 * run whose recorded holder is another live process.
 */
export function takeDagRunLease(
  store: LeaseStore,
  runId: DagRunId,
  probe: Pick<DagRunHolderProbe, "hostPid" | "isProcessAlive">,
): LeasedRecord | undefined {
  return store.withRunLock(runId, () => {
    const fresh = store.readCheckpoint<LeasedRecord>(runId)
    if (fresh === null) return undefined
    if (fresh.leaseHolderPid === probe.hostPid) return fresh
    if (fresh.leaseHolderPid !== undefined && probe.isProcessAlive(fresh.leaseHolderPid)) return undefined
    const taken = { ...fresh, leaseHolderPid: probe.hostPid }
    store.writeCheckpoint(runId, taken)
    return taken
  })
}

export function releaseDagRunLease(store: LeaseStore, runId: DagRunId, hostPid: number): void {
  store.withRunLock(runId, () => {
    const fresh = store.readCheckpoint<LeasedRecord>(runId)
    if (fresh === null || fresh.leaseHolderPid !== hostPid) return
    const { leaseHolderPid: _leaseHolderPid, previousLeaseHolderPid: _previousLeaseHolderPid, ...released } = fresh
    store.writeCheckpoint(runId, released)
  })
}
