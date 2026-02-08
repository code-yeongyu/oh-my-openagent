import type { TeamTask, TeamTaskStatus } from "./types"

type PendingEdges = Record<string, Set<string>>

export const TEAM_TASK_STATUS_ORDER: Record<TeamTaskStatus, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  deleted: 3,
}

export type TaskReader = (taskId: string) => TeamTask | null

export function wouldCreateCycle(
  fromTaskId: string,
  toTaskId: string,
  pendingEdges: PendingEdges,
  readTask: TaskReader,
): boolean {
  const visited = new Set<string>()
  const queue: string[] = [toTaskId]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    if (current === fromTaskId) {
      return true
    }

    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    const task = readTask(current)
    if (task) {
      for (const dep of task.blockedBy) {
        if (!visited.has(dep)) {
          queue.push(dep)
        }
      }
    }

    const pending = pendingEdges[current]
    if (pending) {
      for (const dep of pending) {
        if (!visited.has(dep)) {
          queue.push(dep)
        }
      }
    }
  }

  return false
}

export function ensureForwardStatusTransition(current: TeamTaskStatus, next: TeamTaskStatus): void {
  const currentOrder = TEAM_TASK_STATUS_ORDER[current]
  const nextOrder = TEAM_TASK_STATUS_ORDER[next]
  if (nextOrder < currentOrder) {
    throw new Error(`invalid_status_transition:${current}->${next}`)
  }
}

export function ensureDependenciesCompleted(
  status: TeamTaskStatus,
  blockedBy: string[],
  readTask: TaskReader,
): void {
  if (status !== "in_progress" && status !== "completed") {
    return
  }

  for (const blockerId of blockedBy) {
    const blocker = readTask(blockerId)
    if (blocker && blocker.status !== "completed") {
      throw new Error(`blocked_by_incomplete:${blockerId}:${blocker.status}`)
    }
  }
}

export function createPendingEdgeMap(): PendingEdges {
  return {}
}

export function addPendingEdge(pendingEdges: PendingEdges, from: string, to: string): void {
  const existing = pendingEdges[from] ?? new Set<string>()
  existing.add(to)
  pendingEdges[from] = existing
}
