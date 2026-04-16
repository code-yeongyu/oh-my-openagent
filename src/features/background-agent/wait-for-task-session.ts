import { getTimingConfig } from "../../tools/delegate-task/timing"
import type { BackgroundTaskStatus } from "./types"

type SessionWaitTerminalStatus = Extract<BackgroundTaskStatus, "error" | "cancelled" | "interrupt">
type AbortSignalLike = { aborted: boolean }

interface TaskReader {
  getTask(taskID: string): { sessionID?: string; status?: BackgroundTaskStatus } | undefined
}

export interface WaitForTaskSessionIDOptions {
  timeoutMs?: number
  intervalMs?: number
  signal?: AbortSignalLike
}

function isTerminalStatus(status: BackgroundTaskStatus | undefined): status is SessionWaitTerminalStatus {
  return status === "error" || status === "cancelled" || status === "interrupt"
}

function waitForInterval(intervalMs: number): Promise<void> {
  return new Promise(resolve => {
    const scheduler = globalThis as { setTimeout: (handler: () => void, timeout?: number) => unknown }
    scheduler.setTimeout(resolve, intervalMs)
  })
}

export async function waitForTaskSessionID(
  manager: TaskReader,
  taskID: string,
  options: WaitForTaskSessionIDOptions = {}
): Promise<string | undefined> {
  const timing = getTimingConfig()
  const timeoutMs = options.timeoutMs ?? timing.WAIT_FOR_SESSION_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? timing.WAIT_FOR_SESSION_INTERVAL_MS

  if (options.signal?.aborted) {
    return undefined
  }

  const initialTask = manager.getTask(taskID)
  if (initialTask?.sessionID) {
    return initialTask.sessionID
  }
  if (isTerminalStatus(initialTask?.status)) {
    return undefined
  }

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      return undefined
    }

    await waitForInterval(intervalMs)

    const task = manager.getTask(taskID)
    if (task?.sessionID) {
      return task.sessionID
    }
    if (isTerminalStatus(task?.status)) {
      return undefined
    }
  }

  return undefined
}
