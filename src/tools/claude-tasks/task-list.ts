import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { TaskSchema, type Task } from "../../features/claude-tasks/types"
import { getTaskDir, readJsonSafe } from "../../features/claude-tasks/storage"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export function createTaskList(config: Partial<OhMyOpenCodeConfig>, teamName: string) {
  return tool({
    description: `List all tasks in the team's task list.

1. Check TaskList periodically, **especially after completing each task**, to find available work or see newly unblocked tasks
- Check TaskList first to avoid creating duplicate tasks
- Use TaskList to see all tasks in summary form.
- After resolving, call TaskList to find your next task
Task completed. Call TaskList now to find your next available task or see if your work unblocked others.`,
    args: {},
    execute: async () => {
      const taskDir = getTaskDir(teamName, config)

      if (!existsSync(taskDir)) {
        return JSON.stringify({ tasks: [] })
      }

      const files = readdirSync(taskDir).filter((f) => f.endsWith(".json") && !f.startsWith("."))

      if (files.length === 0) {
        return JSON.stringify({ tasks: [] })
      }

      const tasks: Task[] = []
      for (const file of files) {
        const task = readJsonSafe(join(taskDir, file), TaskSchema)
        if (task && task.status !== "deleted") {
          tasks.push(task)
        }
      }

      tasks.sort((a, b) => {
        const aNum = parseInt(a.id, 10)
        const bNum = parseInt(b.id, 10)
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum
        }
        return a.id.localeCompare(b.id)
      })

      const summary = tasks.map((task) => {
        const item: {
          id: string
          subject: string
          status: Task["status"]
          owner?: string
          blockedBy: string[]
        } = {
          id: task.id,
          subject: task.subject,
          status: task.status,
          blockedBy: task.blockedBy,
        }

        if (task.owner) {
          item.owner = task.owner
        }

        return item
      })

      return JSON.stringify({ tasks: summary })
    },
  })
}
