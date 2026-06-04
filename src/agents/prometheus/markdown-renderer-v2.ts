import { buildTaskTree, calculateProgress } from "../../features/claude-tasks/tree-utils"
import type { TaskTree } from "../../features/claude-tasks/tree-utils"
import { TASK_MAX_DEPTH } from "../../features/claude-tasks/storage"
import type { Task } from "../../tools/task/types"

const INDENT = "  "

export function generateNumbering(path: number[]): string {
  return path.join(".")
}

export function renderNode(
  task: Task,
  depth: number,
  children: Task[],
  tree: TaskTree,
  activeTasks: Task[]
): string {
  const indent = INDENT.repeat(depth)
  const checkbox = task.status === "completed" ? "[x]" : "[ ]"
  
  const pathArray = getNumberingPath(task, tree)
  const numbering = generateNumbering(pathArray)
  
  const isLeaf = children.length === 0
  
  if (depth >= TASK_MAX_DEPTH) {
    return `${indent}- ${checkbox} ${numbering}. ${task.subject} ⚠️ Subtasks collapsed (max depth exceeded)\n`
  }
  
  if (isLeaf) {
    let output = `${indent}- ${checkbox} ${numbering}. ${task.subject}\n`
    output += `${indent}  **What to do:**\n`
    output += `${indent}  ${task.description}\n`
    
    if (task.activeForm) {
      output += `${indent}  **Acceptance Criteria:**\n`
      output += `${indent}  ${task.activeForm}\n`
    }
    
    return output
  }
  
  const progress = calculateProgress(task.id, activeTasks)
  const progressIndicator = `[${progress.completed}/${progress.total}]`
  
  return `${indent}- ${checkbox} ${numbering}. ${task.subject} ${progressIndicator}\n`
}

function getNumberingPath(task: Task, tree: TaskTree): number[] {
  const { byId, childrenByParent, roots } = tree
  const path: number[] = []
  
  const ancestors: Task[] = []
  let current: Task | undefined = task
  
  while (current) {
    ancestors.unshift(current)
    current = current.parentID ? byId.get(current.parentID) : undefined
  }
  
  for (let i = 0; i < ancestors.length; i++) {
    const node = ancestors[i]
    const parent = i > 0 ? ancestors[i - 1] : undefined
    
    if (!parent) {
      const index = roots.findIndex((r) => r.id === node.id)
      path.push(index + 1)
    } else {
      const siblings = childrenByParent.get(parent.id) ?? []
      const index = siblings.findIndex((s) => s.id === node.id)
      path.push(index + 1)
    }
  }
  
  return path
}

export function renderTaskTree(tasks: Task[]): string {
  const activeTasks = tasks.filter((t) => t.status !== "deleted")
  
  if (activeTasks.length === 0) {
    return ""
  }
  
  const tree = buildTaskTree(activeTasks)
  const { roots, childrenByParent } = tree
  let output = ""
  
  function renderRecursive(task: Task, depth: number): void {
    const children = childrenByParent.get(task.id) ?? []
    const activeChildren = children.filter((c) => c.status !== "deleted")
    
    output += renderNode(task, depth, activeChildren, tree, activeTasks)
    
    if (depth < TASK_MAX_DEPTH) {
      for (const child of activeChildren) {
        renderRecursive(child, depth + 1)
      }
    }
  }
  
  for (const root of roots) {
    renderRecursive(root, 0)
  }
  
  return output
}
