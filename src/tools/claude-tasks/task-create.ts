import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { TaskSchema, type Task } from "../../features/claude-tasks/types"
import { getTaskDir, ensureDir, writeJsonAtomic, acquireLock } from "../../features/claude-tasks/storage"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export function createTaskCreate(config: Partial<OhMyOpenCodeConfig>, teamName: string) {
  return tool({
    description: `Create a new task in the team's task list.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status \`pending\`.`,
    args: {
      subject: tool.schema.string().describe("Task subject in imperative form (e.g., 'Run tests')"),
      description: tool.schema.string().describe("Detailed task description"),
      activeForm: tool.schema.string().optional().describe("Present continuous form for spinner (e.g., 'Running tests')"),
      metadata: tool.schema.object({}).optional().describe("Optional metadata object"),
    },
    execute: async (args) => {
      const taskDir = getTaskDir(teamName, config)
      const lock = acquireLock(taskDir)

      try {
        ensureDir(taskDir)

        const files = existsSync(taskDir)
          ? readdirSync(taskDir).filter((f: string) => f.endsWith(".json") && !f.startsWith("."))
          : []

        const ids = files.map((f: string) => parseInt(f.replace(".json", ""), 10)).filter((n: number) => !isNaN(n))
        const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1

        const task: Task = {
          id: String(nextId),
          subject: args.subject,
          description: args.description,
          status: "pending",
          activeForm: args.activeForm,
          blocks: [],
          blockedBy: [],
          metadata: args.metadata,
        }

        const validatedTask = TaskSchema.parse(task)
        writeJsonAtomic(join(taskDir, `${nextId}.json`), validatedTask)

        return JSON.stringify({
          task: {
            id: validatedTask.id,
            subject: validatedTask.subject,
          },
        })
      } finally {
        lock.release()
      }
    },
  })
}
