import { tool } from "@opencode-ai/plugin/tool"
import { join } from "path"
import { TaskSchema } from "../../features/claude-tasks/types"
import { getTaskDir, readJsonSafe } from "../../features/claude-tasks/storage"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export function createTaskGet(config: Partial<OhMyOpenCodeConfig>, teamName: string) {
  return tool({
    description: `Get a task by ID from the team's task list.

Make sure to read a task's latest state using \`TaskGet\` before updating it.
- After fetching a task, verify its blockedBy list is empty before beginning work.`,
    args: {
      taskId: tool.schema.string().describe("Task ID to retrieve"),
    },
    execute: async (args) => {
      const taskDir = getTaskDir(teamName, config)
      const taskPath = join(taskDir, `${args.taskId}.json`)
      const task = readJsonSafe(taskPath, TaskSchema)

      return JSON.stringify({
        task: task,
      })
    },
  })
}
