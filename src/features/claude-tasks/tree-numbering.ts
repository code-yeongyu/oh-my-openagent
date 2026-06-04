import type { Task } from "../../tools/task/types"
import { TASK_MAX_DEPTH } from "./storage"
import { createTaskIndex, getAncestors, calculateDepth } from "./tree-utils"

export interface NumberingInfo {
  depth: number
  numberingPath: number[]
}

export interface NumberedTreeResult {
  childrenByParent: Map<string | undefined, Task[]>
  taskNumbers: Map<string, NumberingInfo>
  orphans: Task[]
  depthExceeded: string[]
}

export function buildNumberedTree(tasks: Task[]): NumberedTreeResult {
  const byId = createTaskIndex(tasks)
  const childrenByParent = new Map<string | undefined, Task[]>()
  const taskNumbers = new Map<string, NumberingInfo>()
  const orphans: Task[] = []
  const depthExceeded: string[] = []

  for (const task of tasks) {
    if (!task.parentID) {
      const rootChildren = childrenByParent.get(undefined) ?? []
      rootChildren.push(task)
      childrenByParent.set(undefined, rootChildren)
    } else if (!byId.has(task.parentID)) {
      orphans.push(task)
    }
  }

  const activeRoots = (childrenByParent.get(undefined) ?? []).filter(
    (t) => t.status !== "deleted"
  )
  activeRoots.sort((a, b) => a.id.localeCompare(b.id))
  childrenByParent.set(undefined, activeRoots)

  for (let i = 0; i < activeRoots.length; i++) {
    taskNumbers.set(activeRoots[i].id, {
      depth: 0,
      numberingPath: [i + 1],
    })
  }

  const processChildren = (parentId: string, parentPath: number[], parentDepth: number) => {
    const children = tasks.filter(
      (t) => t.parentID === parentId && t.status !== "deleted" && byId.has(t.id)
    )

    children.sort((a, b) => a.id.localeCompare(b.id))
    childrenByParent.set(parentId, children)

    const newDepth = parentDepth + 1
    if (newDepth > TASK_MAX_DEPTH) {
      for (const child of children) {
        depthExceeded.push(child.id)
      }
      return
    }

    for (let i = 0; i < children.length; i++) {
      const childPath = [...parentPath, i + 1]
      taskNumbers.set(children[i].id, {
        depth: newDepth,
        numberingPath: childPath,
      })
    }

    for (const child of children) {
      const childPath = taskNumbers.get(child.id)!.numberingPath
      processChildren(child.id, childPath, newDepth)
    }
  }

  for (const root of activeRoots) {
    processChildren(root.id, [activeRoots.indexOf(root) + 1], 0)
  }

  for (const task of tasks) {
    if (!taskNumbers.has(task.id) && task.status === "deleted") {
      const depth = calculateDepth(task.id, tasks)
      const ancestors = getAncestors(task.id, tasks).reverse()

      if (ancestors.length === 0) {
        const allRoots = tasks.filter((t) => !t.parentID)
        allRoots.sort((a, b) => a.id.localeCompare(b.id))
        const index = allRoots.findIndex((r) => r.id === task.id)
        if (index >= 0) {
          taskNumbers.set(task.id, {
            depth: 0,
            numberingPath: [index + 1],
          })
        }
      } else {
        const parentPath = taskNumbers.get(ancestors[ancestors.length - 1].id)
        if (parentPath) {
          const allSiblings = tasks.filter((t) => t.parentID === task.parentID)
          allSiblings.sort((a, b) => a.id.localeCompare(b.id))
          const siblingIndex = allSiblings.findIndex((s) => s.id === task.id)
          
          taskNumbers.set(task.id, {
            depth: depth,
            numberingPath: [...parentPath.numberingPath, siblingIndex + 1],
          })
        }
      }
    }
  }

  return {
    childrenByParent,
    taskNumbers,
    orphans,
    depthExceeded,
  }
}
