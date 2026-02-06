import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { join } from "path"
import { existsSync, readdirSync } from "fs"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { TaskObject, TaskStatus } from "./types"
import { TaskObjectSchema } from "./types"
import { readJsonSafe, getTaskDir } from "../../features/claude-tasks/storage"

interface TaskSummary {
  id: string
  subject: string
  status: TaskStatus
  owner?: string
  blockedBy: string[]
}

export function createTaskList(config: Partial<OhMyOpenCodeConfig>): ToolDefinition {
  return tool({
    description: `List all active tasks with summary information.
    
Returns tasks excluding completed and deleted statuses by default.
For each task's blockedBy field, filters to only include unresolved (non-completed) blockers.
Returns summary format: id, subject, status, owner, blockedBy (not full description).`,
    args: {},
    execute: async (): Promise<string> => {
      const taskDir = getTaskDir(config)

      if (!existsSync(taskDir)) {
        return JSON.stringify({ tasks: [] })
      }

      const files = readdirSync(taskDir)
        .filter((f) => f.endsWith(".json") && f.startsWith("T-"))
        .map((f) => f.replace(".json", ""))

      if (files.length === 0) {
        return JSON.stringify({ tasks: [] })
      }

      const allTasks: TaskObject[] = []
      for (const fileId of files) {
        const task = readJsonSafe(join(taskDir, `${fileId}.json`), TaskObjectSchema)
        if (task) {
          allTasks.push(task)
        }
      }

      // Filter out completed and deleted tasks
      const activeTasks = allTasks.filter(
        (task) => task.status !== "completed" && task.status !== "deleted"
      )

      // Build summary with filtered blockedBy
      const summaries: TaskSummary[] = activeTasks.map((task) => {
        // Filter blockedBy to only include unresolved (non-completed) blockers
        const unresolvedBlockers = task.blockedBy.filter((blockerId) => {
          const blockerTask = allTasks.find((t) => t.id === blockerId)
          // Include if blocker doesn't exist (missing) or if it's not completed
          return !blockerTask || blockerTask.status !== "completed"
        })

        return {
          id: task.id,
          subject: task.subject,
          status: task.status,
          owner: task.owner,
          blockedBy: unresolvedBlockers,
        }
      })

       return JSON.stringify({
         tasks: summaries,
         reminder: "1 task = 1 task. Maximize parallel execution by running independent tasks (tasks with empty blockedBy) concurrently."
       })
    },
  })
}
