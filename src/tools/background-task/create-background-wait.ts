import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundOutputManager, BackgroundOutputClient } from "./clients"
import { BACKGROUND_WAIT_DESCRIPTION } from "./constants"
import { formatCouncilTaskResult, isCouncilTask } from "./council-result-format"
import { delay } from "./delay"
import { formatTaskResult } from "./task-result-format"

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
    async execute(args: { task_ids: string[]; timeout?: number }, toolContext?: unknown) {
      const abort = (toolContext as { abort?: AbortSignal } | undefined)?.abort

      const taskIds = args.task_ids
      if (!taskIds || taskIds.length === 0) {
        return JSON.stringify({
          error: "task_ids array is required and must not be empty.",
          progress: { done: 0, total: 0, bar: "" },
          members: [],
          remaining_task_ids: [],
          completed_task: null,
          timeout: false,
          aborted: false,
        }, null, 2)
      }

      const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

      const alreadyTerminal = findFirstTerminal(manager, taskIds)
      if (alreadyTerminal) {
        return await buildCompletionResult(alreadyTerminal, manager, client, taskIds)
      }

      const startTime = Date.now()
      while (Date.now() - startTime < timeoutMs) {
        if (abort?.aborted) {
          return buildProgressSummary(manager, taskIds, { aborted: true })
        }

        await delay(1000)

        const found = findFirstTerminal(manager, taskIds)
        if (found) {
          return await buildCompletionResult(found, manager, client, taskIds)
        }
      }

      return buildProgressSummary(manager, taskIds, { timeout: true })
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

function buildMemberEntry(manager: BackgroundOutputManager, id: string): Record<string, unknown> {
  const task = manager.getTask(id)
  if (!task) {
    return { task_id: id, description: id, status: "not_found" }
  }

  const entry: Record<string, unknown> = {
    task_id: id,
    description: task.description || id,
    status: task.status,
  }

  if (task.sessionState) entry.session_state = task.sessionState
  if (task.progress?.lastUpdate) {
    entry.last_activity_s = Math.floor((Date.now() - task.progress.lastUpdate.getTime()) / 1000)
  }
  if (task.progress?.toolCalls !== undefined) entry.tool_calls = task.progress.toolCalls
  if (task.error) entry.error = task.error
  if (task.startedAt) entry.duration_s = Math.floor((Date.now() - task.startedAt.getTime()) / 1000)
  if (task.sessionID) entry.session_id = task.sessionID

  return entry
}

function buildProgressSummary(
  manager: BackgroundOutputManager,
  taskIds: string[],
  flags: { timeout?: boolean; aborted?: boolean },
): string {
  const doneIds = taskIds.filter((id) => isTerminal(manager.getTask(id)?.status ?? ""))
  const members = taskIds.map((id) => buildMemberEntry(manager, id))
  const remaining = taskIds.filter((id) => !isTerminal(manager.getTask(id)?.status ?? ""))

  return JSON.stringify({
    progress: { done: doneIds.length, total: taskIds.length, bar: progressBar(doneIds.length, taskIds.length) },
    members,
    remaining_task_ids: remaining,
    completed_task: null,
    timeout: flags.timeout ?? false,
    aborted: flags.aborted ?? false,
  }, null, 2)
}

async function buildCompletionResult(
  completed: { id: string; status: string },
  manager: BackgroundOutputManager,
  client: BackgroundOutputClient,
  allIds: string[],
): Promise<string> {
  const task = manager.getTask(completed.id)
  if (!task) {
    return JSON.stringify({
      progress: { done: 0, total: allIds.length, bar: progressBar(0, allIds.length) },
      members: allIds.map((id) => buildMemberEntry(manager, id)),
      remaining_task_ids: allIds,
      completed_task: { task_id: completed.id, description: completed.id, status: "not_found", error: "Task was deleted" },
      timeout: false,
      aborted: false,
    }, null, 2)
  }

  const doneIds = allIds.filter((id) => isTerminal(manager.getTask(id)?.status ?? ""))
  const members = allIds.map((id) => buildMemberEntry(manager, id))
  const remaining = allIds.filter((id) => !isTerminal(manager.getTask(id)?.status ?? ""))

  const completedTask: Record<string, unknown> = {
    task_id: task.id,
    description: task.description || task.id,
    status: task.status,
  }

  if (task.startedAt) {
    const endTime = task.completedAt ?? new Date()
    completedTask.duration_s = Math.floor((endTime.getTime() - task.startedAt.getTime()) / 1000)
  }
  if (task.sessionID) completedTask.session_id = task.sessionID

  if (task.status === "completed") {
    if (isCouncilTask(task)) {
      const councilResult = await formatCouncilTaskResult(task, client)
      completedTask.has_response = councilResult.has_response
      completedTask.response_complete = councilResult.response_complete
      completedTask.result = councilResult.result
    } else {
      completedTask.result = await formatTaskResult(task, client)
    }
  } else {
    if (task.error) completedTask.error = task.error
  }

  return JSON.stringify({
    progress: { done: doneIds.length, total: allIds.length, bar: progressBar(doneIds.length, allIds.length) },
    members,
    remaining_task_ids: remaining,
    completed_task: completedTask,
    timeout: false,
    aborted: false,
  }, null, 2)
}

function progressBar(done: number, total: number): string {
  const filled = "#".repeat(done)
  const empty = "-".repeat(total - done)
  return `${filled}${empty}`
}
