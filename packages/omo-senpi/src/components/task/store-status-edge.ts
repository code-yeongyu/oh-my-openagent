import type { TaskRecord, TaskRecordStore, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { TaskTerminalObservers } from "./terminal-observers"

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Status-edge detector for one store write. The prior status is read from the backing store BEFORE
 * the write, so a terminal status written through any surface - save, replace, mutate, transition -
 * is recognised as an edge exactly once. Reconciliation writes `lost` through replace/mutate, which
 * the transition-only completion bridge cannot see; this is the seam that catches those.
 */
export interface StatusEdgeWatch {
  /** Report the record the write produced (or nothing when the write changed no record). */
  readonly settle: (record: TaskRecord | null | undefined) => void
}

export function watchStatusEdge(input: {
  readonly backing: TaskRecordStore
  readonly observers: TaskTerminalObservers | undefined
  readonly taskId: string
}): StatusEdgeWatch {
  const { backing, observers, taskId } = input
  if (observers === undefined) return { settle: () => undefined }
  const previousStatus = readStatus(backing, taskId)
  return {
    settle: (record) => {
      if (record === null || record === undefined) return
      if (!isTerminalStatus(record.status)) return
      if (previousStatus !== undefined && isTerminalStatus(previousStatus)) return
      observers.notify({ record, ...(previousStatus === undefined ? {} : { previousStatus }) })
    },
  }
}

// A store read must never break the write it precedes: an unreadable or half-written record simply
// leaves the prior status unknown, which the edge rule treats as "was not terminal".
function readStatus(backing: TaskRecordStore, taskId: string): TaskStatus | undefined {
  try {
    return backing.load(taskId)?.status
  } catch {
    return undefined
  }
}
