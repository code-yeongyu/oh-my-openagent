import type { Task } from "./types"
import { calculateDepth, getAncestors, getDescendants } from "../../features/claude-tasks/tree-utils"
import { TASK_MAX_DEPTH } from "../../features/claude-tasks/storage"

export interface ValidationError {
  error: "task_parent_not_found" | "task_cycle_detected" | "task_max_depth_exceeded"
}

export function validateParentExists(parentID: string | undefined, tasks: Task[]): ValidationError | null {
  if (!parentID) {
    return null
  }

  const parentExists = tasks.some((t) => t.id === parentID)
  if (!parentExists) {
    return { error: "task_parent_not_found" }
  }

  return null
}

export function validateNoCycles(taskId: string, newParentID: string | undefined, tasks: Task[]): ValidationError | null {
  if (!newParentID) {
    return null
  }

  if (taskId === newParentID) {
    return { error: "task_cycle_detected" }
  }

  const ancestors = getAncestors(newParentID, tasks)
  if (ancestors.some((a) => a.id === taskId)) {
    return { error: "task_cycle_detected" }
  }

  return null
}

export function validateMaxDepth(taskId: string, tasks: Task[]): ValidationError | null {
  const depth = calculateDepth(taskId, tasks)

  if (depth >= TASK_MAX_DEPTH) {
    return { error: "task_max_depth_exceeded" }
  }

  return null
}

export function validateReparentingDepth(
  taskId: string,
  newParentID: string | undefined,
  tasks: Task[]
): ValidationError | null {
  if (!newParentID) {
    return null
  }

  const newParentDepth = calculateDepth(newParentID, tasks)
  if (newParentDepth >= TASK_MAX_DEPTH - 1) {
    return { error: "task_max_depth_exceeded" }
  }

  const descendants = getDescendants(taskId, tasks)
  for (const descendant of descendants) {
    const descendantDepth = calculateDepth(descendant.id, tasks)
    const newDescendantDepth = descendantDepth - calculateDepth(taskId, tasks) + newParentDepth + 1

    if (newDescendantDepth >= TASK_MAX_DEPTH) {
      return { error: "task_max_depth_exceeded" }
    }
  }

  return null
}
