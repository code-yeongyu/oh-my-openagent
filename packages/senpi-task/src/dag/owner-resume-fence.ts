import type { OwnerResumeFence, OwnerResumeVerdict } from "../manager/types"
import type { DagRunRecordV1 } from "./manager"
import { ownedClaimAge } from "./owned-attempt"
import type { DagFileStore } from "./store"
import { TERMINAL_DAG_RUN_STATUSES, type DagRunId } from "./types"

const ALLOW: OwnerResumeVerdict = { kind: "allow" }

/**
 * The DAG side of the self-resume fence (#11381). The decision rests on the run's DURABLE checkpoint:
 * every journal append rewrites it synchronously, and the manager asks inside the record mutation
 * that would reopen the child, so no amendment, retry or terminal append can land between the read
 * and the reopen. The claim must be the node's CURRENT one by the shared classifier and the run must
 * not be settled. A loaded scheduler may only ADD a refusal - a cancellation that started but has not
 * journaled yet - and never allows what the checkpoint refuses. An unknown run, or an active one with
 * no scheduler loaded, keeps today's behaviour: the child reopens and is re-watched.
 */
export function createDagOwnerResumeFence(ports: {
  readonly store: DagFileStore
  readonly cancelling?: (runId: DagRunId) => boolean
}): OwnerResumeFence {
  return (task) => {
    const owner = task.owner
    if (owner === undefined) return ALLOW
    const run = ports.store.readCheckpoint<DagRunRecordV1>(owner.runId)
    if (run === null) return ALLOW
    if (TERMINAL_DAG_RUN_STATUSES.has(run.status)) return refuse(`its DAG run "${run.runId}" is ${run.status}`)
    const age = ownedClaimAge(task, run)
    if (age !== "current") {
      const removed = !run.nodes.some((node) => node.id === owner.nodeId)
      return refuse(
        removed ? `its DAG node "${owner.nodeId}" was removed` : `it is a ${age} claim of DAG node "${owner.nodeId}"`,
      )
    }
    if (ports.cancelling?.(run.runId) === true) return refuse(`its DAG run "${run.runId}" is being cancelled`)
    return ALLOW
  }
}

function refuse(reason: string): OwnerResumeVerdict {
  return { kind: "refuse", reason }
}
