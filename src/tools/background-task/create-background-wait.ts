import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundOutputManager, BackgroundOutputClient } from "./clients"
import { BACKGROUND_WAIT_DESCRIPTION } from "./constants"
import { delay } from "./delay"
import { formatTaskResult } from "./task-result-format"
import { formatTaskStatus } from "./task-status-format"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled", "interrupt"])

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function createBackgroundWait(manager: BackgroundOutputManager, client: BackgroundOutputClient): ToolDefinition {
  return tool({
    description: BACKGROUND_WAIT_DESCRIPTION,
    args: {
      task_ids: tool.schema.array(tool.schema.string()).describe("Task IDs to monitor — returns when ANY one reaches a terminal state"),
      timeout: tool.schema.number().optional().describe("Max wait in ms. Default: 120000 (2 min). The tool returns immediately when any task finishes, so large values are fine."),
    },
    async execute(args: { task_ids: string[]; timeout?: number }) {
      const taskIds = args.task_ids
      if (!taskIds || taskIds.length === 0) {
        return "Error: task_ids array is required and must not be empty."
      }

      const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

      const alreadyTerminal = findFirstTerminal(manager, taskIds)
      if (alreadyTerminal) {
        return await buildCompletionResult(alreadyTerminal, manager, client, taskIds)
      }

      const startTime = Date.now()
      while (Date.now() - startTime < timeoutMs) {
        await delay(1000)

        const found = findFirstTerminal(manager, taskIds)
        if (found) {
          return await buildCompletionResult(found, manager, client, taskIds)
        }
      }

      return buildProgressSummary(manager, taskIds, true)
    },
  })
}

function findFirstTerminal(manager: BackgroundOutputManager, taskIds: string[]): { id: string; status: string } | undefined {
  for (const id of taskIds) {
    const task = manager.getTask(id)
    if (!task) continue
    if (isTerminal(task.status)) {
      return { id, status: task.status }
    }
  }
  return undefined
}

async function buildCompletionResult(
  completed: { id: string; status: string },
  manager: BackgroundOutputManager,
  client: BackgroundOutputClient,
  allIds: string[],
): Promise<string> {
  const task = manager.getTask(completed.id)
  if (!task) return `Task was deleted: ${completed.id}`

  const taskResult = task.status === "completed"
    ? await formatTaskResult(task, client)
    : formatTaskStatus(task)

  const summary = buildProgressSummary(manager, allIds, false)
  const remaining = allIds.filter((id) => !isTerminal(manager.getTask(id)?.status ?? ""))

  const lines = [summary, "", "---", "", taskResult]

  if (remaining.length > 0) {
    const idList = remaining.map((id) => `"${id}"`).join(", ")
    lines.push("", `**${remaining.length} task${remaining.length === 1 ? "" : "s"} still running.** Call background_wait again with task_ids: [${idList}]`)
  } else {
    lines.push("", "**All tasks complete.** Proceed with synthesis.")
  }

  return lines.join("\n")
}

function buildProgressSummary(manager: BackgroundOutputManager, taskIds: string[], isTimeout: boolean): string {
  const done = taskIds.filter((id) => isTerminal(manager.getTask(id)?.status ?? ""))
  const total = taskIds.length

  const header = isTimeout
    ? `## Still Waiting: [${progressBar(done.length, total)}] ${done.length}/${total}`
    : `## Council Progress: [${progressBar(done.length, total)}] ${done.length}/${total}`

  const lines = [header, ""]

  for (const id of taskIds) {
    const t = manager.getTask(id)
    if (!t) {
      lines.push(`- \`${id}\` — not found`)
      continue
    }
    const marker = isTerminal(t.status) ? "received" : "waiting..."
    lines.push(`- ${t.description || t.id} — ${marker}`)
  }

  if (isTimeout) {
    const remaining = taskIds.filter((id) => !isTerminal(manager.getTask(id)?.status ?? ""))
    if (remaining.length > 0) {
      const idList = remaining.map((id) => `"${id}"`).join(", ")
      lines.push("", `**Timeout — tasks still running.** Call background_wait again with task_ids: [${idList}]`)
    }
  }

  return lines.join("\n")
}

function progressBar(done: number, total: number): string {
  const filled = "#".repeat(done)
  const empty = "-".repeat(total - done)
  return `${filled}${empty}`
}
