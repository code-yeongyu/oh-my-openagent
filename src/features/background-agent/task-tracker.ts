import { log } from "../../shared"
import { subagentSessions } from "../claude-code-session-state"

import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"

export async function trackExternalTask(args: {
  input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }
  tasks: Map<string, BackgroundTask>
  pendingByParent: Map<string, Set<string>>
  concurrencyManager: ConcurrencyManager
  startPolling: () => void
  cleanupPendingByParent: (task: BackgroundTask) => void
}): Promise<BackgroundTask> {
  const { input, tasks, pendingByParent, concurrencyManager, startPolling, cleanupPendingByParent } = args

  const existingTask = tasks.get(input.taskId)
  if (existingTask) {
    const parentChanged = input.parentSessionID !== existingTask.parentSessionID
    if (parentChanged) {
      cleanupPendingByParent(existingTask)
      existingTask.parentSessionID = input.parentSessionID
    }
    if (input.parentAgent !== undefined) {
      existingTask.parentAgent = input.parentAgent
    }
    if (!existingTask.concurrencyGroup) {
      existingTask.concurrencyGroup = input.concurrencyKey ?? existingTask.agent
    }

    if (existingTask.sessionID) {
      subagentSessions.add(existingTask.sessionID)
    }
    startPolling()

    if (existingTask.status === "pending" || existingTask.status === "running") {
      const pending = pendingByParent.get(input.parentSessionID) ?? new Set<string>()
      pending.add(existingTask.id)
      pendingByParent.set(input.parentSessionID, pending)
    } else if (!parentChanged) {
      cleanupPendingByParent(existingTask)
    }

    log("[background-agent] External task already registered:", {
      taskId: existingTask.id,
      sessionID: existingTask.sessionID,
      status: existingTask.status,
    })

    return existingTask
  }

  const concurrencyGroup = input.concurrencyKey ?? input.agent ?? "task"
  if (input.concurrencyKey) {
    await concurrencyManager.acquire(input.concurrencyKey)
  }

  const task: BackgroundTask = {
    id: input.taskId,
    sessionID: input.sessionID,
    parentSessionID: input.parentSessionID,
    parentMessageID: "",
    description: input.description,
    prompt: "",
    agent: input.agent || "task",
    status: "running",
    startedAt: new Date(),
    progress: {
      toolCalls: 0,
      lastUpdate: new Date(),
    },
    parentAgent: input.parentAgent,
    concurrencyKey: input.concurrencyKey,
    concurrencyGroup,
  }

  tasks.set(task.id, task)
  subagentSessions.add(input.sessionID)
  startPolling()

  if (input.parentSessionID) {
    const pending = pendingByParent.get(input.parentSessionID) ?? new Set<string>()
    pending.add(task.id)
    pendingByParent.set(input.parentSessionID, pending)
  }

  log("[background-agent] Registered external task:", { taskId: task.id, sessionID: input.sessionID })
  return task
}
