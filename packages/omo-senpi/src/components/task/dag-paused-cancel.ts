import { cancelPausedDagNode } from "../../../../senpi-task/src/dag/paused-controls"
import { DagNodeControlError } from "../../../../senpi-task/src/dag/node-control-context"
import { currentNodeTask, liveForeignHolder, type DagRunHolderProbe } from "../../../../senpi-task/src/dag/run-lease"
import type { DagSchedulerOptions } from "../../../../senpi-task/src/dag/scheduler"
import type { DagNodeId, DagRunId } from "../../../../senpi-task/src/dag/types"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { isTerminalRecord } from "../../../../senpi-task/src/manager/manager-helpers"
import type { TaskManager } from "../../../../senpi-task/src/manager/types"

export type PausedNodeHoldPort = {
  closeHold(taskId: string, cause: "node_cancelled" | "run_cancelled"): Promise<void>
}

type ChildLookup = Pick<TaskManager, "get" | "getResidentHandle">
type NodeChildLookup = ChildLookup & Pick<TaskManager, "findOwnedTask" | "cancelTask">

/**
 * A cancelled child's session is gone, and its inherited hold with it: closure is proven by the
 * child having ended (terminal record, no live handle), never assumed. A child still alive refuses.
 */
export function endedChildClosure(manager: ChildLookup): PausedNodeHoldPort {
  return {
    async closeHold(taskId) {
      const record = manager.get(taskId)
      if (record === undefined) return
      if (!isTerminalRecord(record) || manager.getResidentHandle(taskId) !== undefined) {
        throw new Error(`task ${taskId} has not ended, so its run hold is still in place`)
      }
    },
  }
}

/** Every node's current child of a run no scheduler holds is ended before the run is journaled cancelled. */
async function endPausedRunChildren(
  manager: NodeChildLookup,
  record: DagRunRecordV1,
  closure: PausedNodeHoldPort,
): Promise<void> {
  for (const node of record.nodes) {
    const task = currentNodeTask(manager, record, node)
    if (task === undefined || isTerminalRecord(task)) continue
    await manager.cancelTask(task.task_id, "run_cancelled", { expectedRunEpoch: task.notification.run_epoch })
    await closure.closeHold(task.task_id, "run_cancelled")
  }
}

/**
 * Cancel of a run no scheduler of this runtime holds (user-stopped, parked, or left running by a dead
 * host): a fresh scheduler's cancel knows none of its children, so they are ended here first. A run
 * another live process holds is that process's to cancel.
 */
export async function endUnheldRunChildren(
  manager: NodeChildLookup,
  record: DagRunRecordV1,
  closure: PausedNodeHoldPort,
  holders: DagRunHolderProbe,
): Promise<void> {
  const holder = liveForeignHolder(holders, record)
  if (holder !== undefined) {
    throw new DagNodeControlError({
      code: "run_not_owned",
      message: `dag run "${record.runId}" is held by live process ${holder}`,
      runId: record.runId,
    })
  }
  await endPausedRunChildren(manager, record, closure)
}

export function createPausedNodeCancel(
  options: (runId: DagRunId) => DagSchedulerOptions,
  holds: PausedNodeHoldPort | undefined,
): (runId: DagRunId, nodeId: string) => Promise<void> {
  return async (runId, nodeId) => {
    const context = options(runId)
    if (holds === undefined)
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: "The engine's inherited-hold close port is not configured.",
        runId,
      })
    await cancelPausedDagNode(context, runId, nodeId as DagNodeId, holds)
  }
}
