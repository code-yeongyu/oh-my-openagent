import type { BackgroundTask } from "./types"

export function getTasksByParentSession(
  tasks: Iterable<BackgroundTask>,
  sessionID: string
): BackgroundTask[] {
  const result: BackgroundTask[] = []
  for (const task of tasks) {
    if (task.parentSessionID === sessionID) {
      result.push(task)
    }
  }
  return result
}

export function getAllDescendantTasks(
  tasksByParent: (sessionID: string) => BackgroundTask[],
  sessionID: string
): BackgroundTask[] {
  const result: BackgroundTask[] = []
  const directChildren = tasksByParent(sessionID)

  for (const child of directChildren) {
    result.push(child)
    if (child.sessionID) {
      result.push(...getAllDescendantTasks(tasksByParent, child.sessionID))
    }
  }

  return result
}

export function findTaskBySession(
  tasks: Iterable<BackgroundTask>,
  sessionID: string
): BackgroundTask | undefined {
  for (const task of tasks) {
    if (task.sessionID === sessionID) return task
  }
  return undefined
}

export function getRunningTasks(tasks: Iterable<BackgroundTask>): BackgroundTask[] {
  return Array.from(tasks).filter((t) => t.status === "running")
}

export function getNonRunningTasks(tasks: Iterable<BackgroundTask>): BackgroundTask[] {
  return Array.from(tasks).filter((t) => t.status !== "running")
}

export function hasRunningTasks(tasks: Iterable<BackgroundTask>): boolean {
  for (const task of tasks) {
    if (task.status === "running") return true
  }
  return false
}
