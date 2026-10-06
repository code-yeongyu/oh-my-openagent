import { log } from "@oh-my-opencode/utils"

import { getLifecycleDetachedRevivalRollback } from "../lifecycle/port"
import type { TaskRecord } from "../state"
import type { SteeringPort } from "./types"

export async function bestEffortRollback(port: SteeringPort, priorRecord: TaskRecord): Promise<void> {
  const rollback = port.rollbackDetachedRevival ?? getLifecycleDetachedRevivalRollback(port.store)
  if (rollback !== undefined) {
    try {
      if (rollback(priorRecord) === "not_owner") return
    } catch (error) {
      log("senpi-task lazy revival rollback failed", {
        taskId: priorRecord.task_id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  try {
    await port.destruction.destroyResidentTask(priorRecord.task_id, "revive_failure")
  } catch (error) {
    log("senpi-task lazy revival destruction failed", {
      taskId: priorRecord.task_id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
