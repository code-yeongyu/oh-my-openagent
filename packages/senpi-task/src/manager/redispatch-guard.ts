// The re-dispatch admission: its lock and the states it refuses (senpi#3266).
import { join } from "node:path"

import type { TaskRecord } from "../state"
import { isTerminalRecord } from "./manager-helpers"
import type { RedispatchOutcome } from "../steering/types"

// A re-dispatch holds its lock across a child launch, which can take far longer than a record write.
export const REDISPATCH_HOLDER_WAIT_MS = 120_000

export function redispatchLockPath(stateDir: string, taskId: string): string {
  return join(stateDir, "redispatch-locks", taskId)
}

export function redispatchRefusal(record: TaskRecord): RedispatchOutcome | undefined {
  if (isTerminalRecord(record)) {
    return {
      kind: "invalid_state",
      task_id: record.task_id,
      reason: `Task ${record.task_id} is ${record.status}; only a task waiting for input can be re-dispatched.`,
    }
  }
  if (record.awaiting_input === undefined) {
    return {
      kind: "invalid_state",
      task_id: record.task_id,
      reason: `Task ${record.task_id} is not waiting for input; only a flagged "resumed, waiting for input" task can be re-dispatched.`,
    }
  }
  return undefined
}
