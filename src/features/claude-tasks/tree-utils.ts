import type { Task } from "../../tools/task/types"

export interface TaskTree {
  roots: Task[]
  byId: Map<string, Task>
  childrenByParent: Map<string, Task[]>
}

export interface Progress {
  completed: number
  total: number
}

export function createTaskIndex(tasks: Task[]): Map<string, Task> {
  const byId = new Map<string, Task>()
  for (const task of tasks) {
    byId.set(task.id, task)
  }
  return byId
}

export function buildTaskTree(tasks: Task[]): TaskTree {
  const byId = createTaskIndex(tasks)
  const childrenByParent = new Map<string, Task[]>()
  const roots: Task[] = []

  for (const task of tasks) {
    if (!task.parentID || !byId.has(task.parentID)) {
      roots.push(task)
    } else {
      const children = childrenByParent.get(task.parentID) ?? []
      children.push(task)
      childrenByParent.set(task.parentID, children)
    }
  }

  return { roots, byId, childrenByParent }
}

export function getDescendants(taskId: string, tasks: Task[]): Task[] {
  const { byId, childrenByParent } = buildTaskTree(tasks)
  if (!byId.has(taskId)) return []

  const result: Task[] = []
  const stack = childrenByParent.get(taskId) ?? []

  while (stack.length > 0) {
    const current = stack.pop()!
    result.push(current)
    const children = childrenByParent.get(current.id) ?? []
    stack.push(...children)
  }

  return result
}

export function getAncestors(taskId: string, tasks: Task[]): Task[] {
  const byId = createTaskIndex(tasks)

  const task = byId.get(taskId)
  if (!task) return []

  const result: Task[] = []
  let currentParentId = task.parentID

  while (currentParentId) {
    const parent = byId.get(currentParentId)
    if (!parent) break
    result.push(parent)
    currentParentId = parent.parentID
  }

  return result
}

export function detectCycles(tasks: Task[]): string[][] {
  const byId = createTaskIndex(tasks)

  const visited = new Set<string>()
  const cycles: string[][] = []

  for (const task of tasks) {
    if (visited.has(task.id)) continue

    const path: string[] = []
    const pathSet = new Set<string>()
    let current: Task | undefined = task

    while (current && !visited.has(current.id)) {
      if (pathSet.has(current.id)) {
        const cycleStart = path.indexOf(current.id)
        cycles.push(path.slice(cycleStart))
        break
      }

      path.push(current.id)
      pathSet.add(current.id)

      if (!current.parentID) break
      current = byId.get(current.parentID)
    }

    for (const id of path) {
      visited.add(id)
    }
  }

  return cycles
}

export function detectOrphans(tasks: Task[]): Task[] {
  const byId = createTaskIndex(tasks)

  return tasks.filter((task) => task.parentID && !byId.has(task.parentID))
}

export function calculateDepth(taskId: string, tasks: Task[]): number {
  const byId = createTaskIndex(tasks)

  const task = byId.get(taskId)
  if (!task) return -1

  let depth = 0
  let currentParentId = task.parentID

  while (currentParentId) {
    const parent = byId.get(currentParentId)
    if (!parent) break
    depth++
    currentParentId = parent.parentID
  }

  return depth
}

export function calculateProgress(taskId: string, tasks: Task[]): Progress {
  const { byId, childrenByParent } = buildTaskTree(tasks)
  const task = byId.get(taskId)
  if (!task) return { completed: 0, total: 0 }

  const getLeafProgress = (id: string): Progress => {
    const children = childrenByParent.get(id) ?? []
    const activeChildren = children.filter((c) => c.status !== "deleted")

    if (activeChildren.length === 0) {
      const t = byId.get(id)!
      if (t.status === "deleted") return { completed: 0, total: 0 }
      return { completed: t.status === "completed" ? 1 : 0, total: 1 }
    }

    let completed = 0
    let total = 0
    for (const child of activeChildren) {
      const childProgress = getLeafProgress(child.id)
      completed += childProgress.completed
      total += childProgress.total
    }
    return { completed, total }
  }

  return getLeafProgress(taskId)
}
