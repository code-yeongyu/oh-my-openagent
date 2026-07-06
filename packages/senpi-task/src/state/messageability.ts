import type { Messageability, ResidencyState, TaskStatus } from "./types"

const continuableStatuses = new Set<TaskStatus>(["pending", "running", "interrupted"])

export function messageability(status: TaskStatus, residencyState: ResidencyState): Messageability {
  if (!continuableStatuses.has(status) || residencyState === "disposed") return "not-continuable"
  if (residencyState === "resident") return "steer"
  return "revive"
}
