import { cancelPausedDagNode } from "../../../../senpi-task/src/dag/paused-controls"
import { DagNodeControlError } from "../../../../senpi-task/src/dag/node-control-context"
import type { DagSchedulerOptions } from "../../../../senpi-task/src/dag/scheduler"
import type { DagNodeId, DagRunId } from "../../../../senpi-task/src/dag/types"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { isTerminalRecord } from "../../../../senpi-task/src/manager/manager-helpers"
import type { TaskManager } from "../../../../senpi-task/src/manager/types"

export type PausedNodeHoldPort = {
  closeHold(taskId: string, cause: "node_cancelled" | "run_cancelled"): Promise<void>
}

type ChildLookup = Pick<TaskManager, "get" | "getResidentHandle">

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

/** Every paused node child of a user-stopped run is ended before the run is journaled cancelled. */
export async function endPausedRunChildren(
  manager: ChildLookup & Pick<TaskManager, "cancelTask">,
  record: DagRunRecordV1,
  closure: PausedNodeHoldPort,
): Promise<void> {
  for (const node of record.nodes) {
    if (node.taskId === undefined) continue
    const task = manager.get(node.taskId)
    if (task === undefined || isTerminalRecord(task)) continue
    await manager.cancelTask(node.taskId, "run_cancelled", { expectedRunEpoch: task.notification.run_epoch })
    await closure.closeHold(node.taskId, "run_cancelled")
  }
}

export function createPausedNodeCancel(
  options: (runId: DagRunId) => DagSchedulerOptions,
  holds: PausedNodeHoldPort | undefined,
): (runId: DagRunId, nodeId: string) => Promise<void> {
  return async (runId, nodeId) => {
    const context = options(runId)
    if (holds === undefined) throw new DagNodeControlError({
      code: "node_not_continuable", message: "The engine's inherited-hold close port is not configured.", runId,
    })
    await cancelPausedDagNode(context, runId, nodeId as DagNodeId, holds)
  }
}
