import type { OwnerResumeFence, OwnerResumeVerdict } from "../manager/types"
import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { ownedClaimAge } from "./owned-attempt"
import type { DagFileStore } from "./store"
import { TERMINAL_DAG_RUN_STATUSES, type DagRunId } from "./types"

const ALLOW: OwnerResumeVerdict = { kind: "allow" }

/**
 * The DAG side of the self-resume fence (#11381). The decision rests on the run's DURABLE checkpoint,
 * which every journal append rewrites synchronously. The manager asks inside the record mutation that
 * would reopen the child, so within ONE process - the one holding the run, its journal writers and
 * this manager - no amendment, retry or terminal append can land between the read and the reopen.
 * That is same-process ordering only: exclusion across processes is the run lease's job, not this
 * read's. The claim must be the node's CURRENT one by the shared classifier and the run must not be
 * settled. A refusal also says what happens to the run it stops: a superseded or removed claim, or a
 * cancelled or cancelling run, is retired; a current claim of a failed or completed run is held. A
 * loaded scheduler may only ADD a refusal - a cancellation that started but has not journaled yet -
 * and never allows what the checkpoint refuses. An unknown run, or an active one with no scheduler
 * loaded, keeps today's behaviour: the child reopens and is re-watched.
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
    return selfResumeVerdict(task, run, ports.cancelling?.(run.runId) === true)
  }
}

/**
 * The one decision about a turn a settled child of `run` started on its own (#11381, #12134): the
 * manager's fence asks it before the turn may run, and the scheduler holding the run asks it before a
 * node re-opens to follow that turn, so no turn runs that no node may follow and no node follows a turn
 * that was refused. Allowed only for the node's current claim of a run that is neither settled nor
 * being cancelled; a paused run allows it, and the scheduler that next holds the run follows it.
 */
export function selfResumeVerdict(task: TaskRecord, run: DagRunRecordV1, cancelling: boolean): OwnerResumeVerdict {
  const age = ownedClaimAge(task, run)
  if (age !== "current") {
    const nodeId = task.owner?.nodeId
    const removed = !run.nodes.some((node) => node.id === nodeId)
    const reason = removed ? `its DAG node "${nodeId}" was removed` : `it is a ${age} claim of DAG node "${nodeId}"`
    return refuse(reason, "retire")
  }
  if (run.status === "cancelled") return refuse(`its DAG run "${run.runId}" was cancelled`, "retire")
  // A current claim of a failed or completed run keeps the explicit send/revive contract: only the
  // unsolicited turn stops, and the child stays as resident and revivable as it was.
  if (TERMINAL_DAG_RUN_STATUSES.has(run.status)) return refuse(`its DAG run "${run.runId}" is ${run.status}`, "hold")
  if (cancelling) return refuse(`its DAG run "${run.runId}" is being cancelled`, "retire")
  return ALLOW
}

function refuse(reason: string, disposition: "retire" | "hold"): OwnerResumeVerdict {
  return { kind: "refuse", reason, disposition }
}
