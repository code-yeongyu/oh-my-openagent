import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager, BackgroundTask, BackgroundTaskStatus } from "../../features/background-agent"
import { log } from "../../shared"
import { WAIT_FOR_BACKGROUND_TASKS_DESCRIPTION } from "./constants"

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 60 * 60 * 1000
const POLL_INTERVAL_MS = 3000
const MAX_RESULT_LENGTH = 24_000
const MAX_TASKS_IN_RESULT = 100
const MAX_DESCRIPTION_LENGTH = 300
const MAX_ACTIVE_DESCRIPTION_LENGTH = 120
const MAX_ERROR_LENGTH = 1_000

const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

interface WaitForBackgroundTasksArgs {
  readonly timeout?: number
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

function truncateField(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}... [truncated]`
}

function truncateResult(value: string): string {
  if (value.length <= MAX_RESULT_LENGTH) return value
  const suffix = "\n\n... [result truncated]"
  return `${value.slice(0, MAX_RESULT_LENGTH - suffix.length)}${suffix}`
}

function formatResult(tasks: BackgroundTask[], timedOut: boolean, timeoutMs: number, aborted = false): string {
  const completed: string[] = []
  const stillRunning: string[] = []
  const prioritizedTasks = [
    ...tasks.filter((task) => !isTerminal(task.status)),
    ...tasks.filter((task) => isTerminal(task.status)),
  ]
  const displayedTasks = prioritizedTasks.slice(0, MAX_TASKS_IN_RESULT)
  const omittedTasks = prioritizedTasks.slice(MAX_TASKS_IN_RESULT)

  for (const task of displayedTasks) {
    if (isTerminal(task.status)) {
      const errorInfo = task.error ? `\n  Error: ${truncateField(task.error, MAX_ERROR_LENGTH)}` : ""
      completed.push(`- \`${task.id}\` (${truncateField(task.description, MAX_DESCRIPTION_LENGTH)}): **${task.status.toUpperCase()}**${errorInfo}`)
    } else {
      stillRunning.push(`- \`${task.id}\` (${truncateField(task.description, MAX_ACTIVE_DESCRIPTION_LENGTH)}): ${task.status}`)
    }
  }

  const sections: string[] = []

  if (timedOut) {
    if (stillRunning.length > 0) {
      sections.push(
        `## Still Running (timed out after ${Math.round(timeoutMs / 1000)}s)\n${stillRunning.join("\n")}\n\nSome tasks did not finish within the timeout. Do NOT end your turn while they remain active; call \`wait-for-background-tasks\` again.`,
      )
    } else {
      sections.push(
        `## Wait Timed Out\nBackground work was still being registered or finalized after ${Math.round(timeoutMs / 1000)}s. Do NOT end your turn; call \`wait-for-background-tasks\` again.`,
      )
    }
  }

  if (aborted) {
    const current = stillRunning.length > 0
      ? `\n\n## Current Tasks\n${stillRunning.join("\n")}`
      : ""
    sections.unshift(`## Wait Aborted\nBackground task wait cancelled because the tool call was aborted.${current}`)
  }

  if (omittedTasks.length > 0) {
    const omittedGuidance = omittedTasks.some((task) => !isTerminal(task.status))
      ? "Omitted tasks may still be active; call `wait-for-background-tasks` again before retrieving their output."
      : "Use `background_output` for omitted task details."
    sections.push(`Result limited to ${MAX_TASKS_IN_RESULT} of ${tasks.length} retained tasks. ${omittedGuidance}`)
  }

  if (completed.length > 0) {
    sections.push(
      `## Terminal Tasks\n${completed.join("\n")}\n\nUse \`background_output(task_id="<id>")\` to retrieve detailed results for each task.`,
    )
  }

  return truncateResult(sections.join("\n\n").trim())
}

export function createWaitForBackgroundTasks(
  manager: BackgroundManager,
  options?: { readonly pollIntervalMs?: number; readonly minimumTimeoutMs?: number },
): ToolDefinition {
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS
  const minimumTimeoutMs = options?.minimumTimeoutMs ?? MIN_TIMEOUT_MS
  return tool({
    description: WAIT_FOR_BACKGROUND_TASKS_DESCRIPTION,
    args: {
      timeout: tool.schema
        .number()
        .min(MIN_TIMEOUT_MS)
        .max(MAX_TIMEOUT_MS)
        .optional()
        .describe("Max wait time in ms (default: 1800000 = 30min, range: 1000-3600000)"),
    },
    async execute(args: WaitForBackgroundTasksArgs, toolContext) {
      try {
        const sessionID = toolContext.sessionID
        const timeoutMs = Math.min(Math.max(args.timeout ?? DEFAULT_TIMEOUT_MS, minimumTimeoutMs), MAX_TIMEOUT_MS)
        const startTime = Date.now()

        let finalTasks = manager.getTasksForBackgroundWait(sessionID)
        const initialActive = activeTasks(finalTasks)
        let observedBackgroundWork = manager.hasBackgroundWorkInFlight(sessionID)

        log("[wait-for-background-tasks] Waiting for tasks", {
          sessionID,
          timeoutMs,
          activeCount: initialActive.length,
          taskIds: initialActive.map((task) => task.id),
        })

        let timedOut = false
        while (true) {
          const remainingMs = timeoutMs - (Date.now() - startTime)
          const backgroundWorkInFlight = manager.hasBackgroundWorkInFlight(sessionID)

          if (!backgroundWorkInFlight) {
            if (remainingMs <= 0) break

            if (await waitForPoll(Math.min(pollIntervalMs, remainingMs), toolContext.abort) === "aborted") {
              finalTasks = manager.getTasksForBackgroundWait(sessionID)
              return formatResult(finalTasks, false, timeoutMs, true)
            }

            finalTasks = manager.getTasksForBackgroundWait(sessionID)
            await Promise.resolve()
            finalTasks = manager.getTasksForBackgroundWait(sessionID)
            if (!manager.hasBackgroundWorkInFlight(sessionID)) break

            observedBackgroundWork = true
            continue
          }

          observedBackgroundWork = true
          if (remainingMs <= 0) {
            timedOut = true
            break
          }

          if (await waitForPoll(Math.min(pollIntervalMs, remainingMs), toolContext.abort) === "aborted") {
            finalTasks = manager.getTasksForBackgroundWait(sessionID)
            return formatResult(finalTasks, false, timeoutMs, true)
          }

          finalTasks = manager.getTasksForBackgroundWait(sessionID)
        }

        if (!observedBackgroundWork && finalTasks.length === 0) {
          return "No running or pending background tasks found for this session."
        }

        if (finalTasks.length === 0) {
          if (timedOut) {
            return `Background task wait timed out after ${Math.round(timeoutMs / 1000)}s while work was still being registered or finalized; no task details remain in memory.`
          }
          return "All background tasks completed (no tasks remaining in memory)."
        }

        log("[wait-for-background-tasks] Finished waiting", {
          sessionID,
          timedOut,
          elapsed: Date.now() - startTime,
        })

        return formatResult(finalTasks, timedOut, timeoutMs)
      } catch (error) {
        return truncateResult(`[ERROR] Error waiting for background tasks: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
}
