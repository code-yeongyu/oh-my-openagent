import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { join } from "path"
import { existsSync, readdirSync } from "fs"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { TaskObject } from "./types"
import { TaskObjectSchema } from "./types"
import { readJsonSafe, getTaskDir } from "../../features/claude-tasks/storage"
import { buildNumberedTree } from "../../features/claude-tasks/tree-numbering"

function formatCheckbox(status: string): string {
  if (status === "completed") {
    return "[x]"
  }
  return "[ ]"
}

function renderTreeNode(
  taskId: string,
  tasks: Map<string, TaskObject>,
  taskNumbers: Map<string, { depth: number; numberingPath: number[] }>,
  childrenByParent: Map<string | undefined, TaskObject[]>
): string {
  const task = tasks.get(taskId)
  if (!task) return ""

  const numberInfo = taskNumbers.get(taskId)
  if (!numberInfo) return ""

  const indent = "  ".repeat(numberInfo.depth)
  const numberStr = numberInfo.numberingPath.join(".")
  const checkbox = formatCheckbox(task.status)
  const line = `${indent}- ${checkbox} ${numberStr}. ${task.subject} (${task.status})`

  const children = childrenByParent.get(taskId) ?? []
  const childLines = children.map((child) => renderTreeNode(child.id, tasks, taskNumbers, childrenByParent))

  return [line, ...childLines].filter((l) => l.length > 0).join("\n")
}

export function createTaskTree(config: Partial<OhMyOpenCodeConfig>): ToolDefinition {
  return tool({
    description: `Render a Markdown task tree with hierarchical numbering (1., 1.1., 1.1.1.).
    
Displays tasks in a nested tree structure with:
- Checkbox: [x] for completed, [ ] for pending/in_progress
- Status label: (pending), (in_progress), (completed)
- 2-space indentation per depth level
- Deleted tasks excluded
- Orphaned tasks shown in separate section with parent reference`,
    args: {},
    execute: async (): Promise<string> => {
      const taskDir = getTaskDir(config)

      if (!existsSync(taskDir)) {
        return "No tasks found."
      }

      const files = readdirSync(taskDir)
        .filter((f) => f.endsWith(".json") && f.startsWith("T-"))
        .map((f) => f.replace(".json", ""))

      if (files.length === 0) {
        return "No tasks found."
      }

      const allTasks: TaskObject[] = []
      for (const fileId of files) {
        const task = readJsonSafe(join(taskDir, `${fileId}.json`), TaskObjectSchema)
        if (task) {
          allTasks.push(task)
        }
      }

      const { childrenByParent, taskNumbers, orphans } = buildNumberedTree(allTasks)

      const tasksMap = new Map<string, TaskObject>()
      for (const task of allTasks) {
        tasksMap.set(task.id, task)
      }

      const rootTasks = childrenByParent.get(undefined) ?? []
      const treeLines: string[] = []

      if (rootTasks.length > 0) {
        treeLines.push("## Task Tree")
        treeLines.push("")
        for (const rootTask of rootTasks) {
          const rendered = renderTreeNode(rootTask.id, tasksMap, taskNumbers, childrenByParent)
          if (rendered) {
            treeLines.push(rendered)
          }
        }
      }

      if (orphans.length > 0) {
        treeLines.push("")
        treeLines.push("## Orphaned Tasks")
        treeLines.push("")
        for (const orphan of orphans) {
          const checkbox = formatCheckbox(orphan.status)
          treeLines.push(`- ${checkbox} ${orphan.subject} (parent '${orphan.parentID}' not found)`)
        }
      }

      if (treeLines.length === 0) {
        return "No tasks found."
      }

      return treeLines.join("\n")
    },
  })
}
