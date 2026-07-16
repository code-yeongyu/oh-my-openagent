import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager, BackgroundTask, BackgroundTaskStatus } from "../../features/background-agent"
import { log } from "../../shared"
import { WAIT_FOR_BACKGROUND_TASKS_DESCRIPTION } from "./constants"

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const MAX_TIMEOUT_MS = 60 * 60 * 1000
const POLL_INTERVAL_MS = 3000

const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

interface WaitForBackgroundTasksArgs {
  timeout?: number
}

function isTerminal(status: BackgroundTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

function activeTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((task) => !isTerminal(task.status))
}

function waitForPoll(ms: number, signal?: AbortSignal): Promise<"elapsed" | "aborted"> {
  if (signal?.aborted) return Promise.resolve("aborted")

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve("aborted")
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve("elapsed")
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function formatResult(tasks: BackgroundTask[], timedOut: boolean, timeoutMs: number): string {
  const completed: string[] = []
  const stillRunning: string[] = []

  for (const task of tasks) {
    if (isTerminal(task.status)) {
      const errorInfo = task.error ? `\n  Error: ${task.error}` : ""
      completed.push(`- \`${task.id}\` (${task.description}): **${task.status.toUpperCase()}**${errorInfo}`)
    } else {
      stillRunning.push(`- \`${task.id}\` (${task.description}): ${task.status}`)
    }
  }

  const sections: string[] = []

  if (completed.length > 0) {
    sections.push(
      `## Completed Tasks\n${completed.join("\n")}\n\nUse \`background_output(task_id="<id>")\` to retrieve detailed results for each task.`,
    )
  }

  if (timedOut && stillRunning.length > 0) {
    sections.push(
      `## Still Running (timed out after ${Math.round(timeoutMs / 1000)}s)\n${stillRunning.join("\n")}\n\nSome tasks did not finish within the timeout. Use \`background_output(task_id="<id>", block=true)\` to wait for individual tasks.`,
    )
  }

  return sections.join("\n\n").trim()
}

export function createWaitForBackgroundTasks(
  manager: BackgroundManager,
  options?: { pollIntervalMs?: number },
): ToolDefinition {
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS
  return tool({
    description: WAIT_FOR_BACKGROUND_TASKS_DESCRIPTION,
    args: {
      timeout: tool.schema
        .number()
        .optional()
        .describe("Max wait time in ms (default: 1800000 = 30min, max: 3600000 = 60min)"),
    },
    async execute(args: WaitForBackgroundTasksArgs, toolContext) {
      try {
        const sessionID = toolContext.sessionID
        const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
        const startTime = Date.now()

        const initialActive = activeTasks(manager.getTasksByParentSession(sessionID))
        if (initialActive.length === 0) {
          return "No running or pending background tasks found for this session."
        }

        log("[wait-for-background-tasks] Waiting for tasks", {
          sessionID,
          timeoutMs,
          activeCount: initialActive.length,
          taskIds: initialActive.map((task) => task.id),
        })

        let timedOut = true
        while (Date.now() - startTime < timeoutMs) {
          if (await waitForPoll(pollIntervalMs, toolContext.abort) === "aborted") {
            return "Background task wait cancelled because the tool call was aborted."
          }
          if (activeTasks(manager.getTasksByParentSession(sessionID)).length === 0) {
            timedOut = false
            break
          }
        }

        const finalTasks = manager.getTasksByParentSession(sessionID)
        if (finalTasks.length === 0) {
          return "All background tasks completed (no tasks remaining in memory)."
        }

        log("[wait-for-background-tasks] Finished waiting", {
          sessionID,
          timedOut,
          elapsed: Date.now() - startTime,
        })

        return formatResult(finalTasks, timedOut, timeoutMs)
      } catch (error) {
        return `[ERROR] Error waiting for background tasks: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
