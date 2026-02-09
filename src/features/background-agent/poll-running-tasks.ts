import { log } from "../../shared"

import {
  MIN_STABILITY_TIME_MS,
} from "./constants"

import type { BackgroundTask } from "./types"
import type { OpencodeClient } from "./opencode-client"

type SessionStatusMap = Record<string, { type: string }>

type MessagePart = {
  type?: string
  tool?: string
  name?: string
  text?: string
}

type SessionMessage = {
  info?: { role?: string }
  parts?: MessagePart[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asSessionMessages(value: unknown): SessionMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord) as SessionMessage[]
}

export async function pollRunningTasks(args: {
  tasks: Iterable<BackgroundTask>
  client: OpencodeClient
  pruneStaleTasksAndNotifications: () => void
  checkAndInterruptStaleTasks: () => Promise<void>
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  hasRunningTasks: () => boolean
  stopPolling: () => void
}): Promise<void> {
  const {
    tasks,
    client,
    pruneStaleTasksAndNotifications,
    checkAndInterruptStaleTasks,
    validateSessionHasOutput,
    checkSessionTodos,
    tryCompleteTask,
    hasRunningTasks,
    stopPolling,
  } = args

  pruneStaleTasksAndNotifications()
  await checkAndInterruptStaleTasks()

  const statusResult = await client.session.status()
  const allStatuses = ((statusResult as { data?: unknown }).data ?? {}) as SessionStatusMap

  for (const task of tasks) {
    if (task.status !== "running") continue

    const sessionID = task.sessionID
    if (!sessionID) continue

    try {
      const sessionStatus = allStatuses[sessionID]
      if (sessionStatus?.type === "idle") {
        const hasValidOutput = await validateSessionHasOutput(sessionID)
        if (!hasValidOutput) {
          log("[background-agent] Polling idle but no valid output yet, waiting:", task.id)
          continue
        }

        if (task.status !== "running") continue

        const hasIncompleteTodos = await checkSessionTodos(sessionID)
        if (hasIncompleteTodos) {
          log("[background-agent] Task has incomplete todos via polling, waiting:", task.id)
          continue
        }

        await tryCompleteTask(task, "polling (idle status)")
        continue
      }

      const messagesResult = await client.session.messages({
        path: { id: sessionID },
      })

      if ((messagesResult as { error?: unknown }).error) {
        continue
      }

      const messagesPayload = Array.isArray(messagesResult)
        ? messagesResult
        : (messagesResult as { data?: unknown }).data
      const messages = asSessionMessages(messagesPayload)
      const assistantMsgs = messages.filter((m) => m.info?.role === "assistant")

      let toolCalls = 0
      let lastTool: string | undefined
      let lastMessage: string | undefined

      for (const msg of assistantMsgs) {
        const parts = msg.parts ?? []
        for (const part of parts) {
          if (part.type === "tool_use" || part.tool) {
            toolCalls += 1
            lastTool = part.tool || part.name || "unknown"
          }
          if (part.type === "text" && part.text) {
            lastMessage = part.text
          }
        }
      }

      if (!task.progress) {
        task.progress = { toolCalls: 0, lastUpdate: new Date() }
      }
      task.progress.toolCalls = toolCalls
      task.progress.lastTool = lastTool
      task.progress.lastUpdate = new Date()
      if (lastMessage) {
        task.progress.lastMessage = lastMessage
        task.progress.lastMessageAt = new Date()
      }

      const currentMsgCount = messages.length
      const startedAt = task.startedAt
      if (!startedAt) continue

      const elapsedMs = Date.now() - startedAt.getTime()
      if (elapsedMs >= MIN_STABILITY_TIME_MS) {
        if (task.lastMsgCount === currentMsgCount) {
          task.stablePolls = (task.stablePolls ?? 0) + 1
          if (task.stablePolls >= 3) {
            const recheckStatus = await client.session.status()
            const recheckData = ((recheckStatus as { data?: unknown }).data ?? {}) as SessionStatusMap
            const currentStatus = recheckData[sessionID]

            if (currentStatus?.type !== "idle") {
              log("[background-agent] Stability reached but session not idle, resetting:", {
                taskId: task.id,
                sessionStatus: currentStatus?.type ?? "not_in_status",
              })
              task.stablePolls = 0
              continue
            }

            const hasValidOutput = await validateSessionHasOutput(sessionID)
            if (!hasValidOutput) {
              log("[background-agent] Stability reached but no valid output, waiting:", task.id)
              continue
            }

            if (task.status !== "running") continue

            const hasIncompleteTodos = await checkSessionTodos(sessionID)
            if (!hasIncompleteTodos) {
              await tryCompleteTask(task, "stability detection")
              continue
            }
          }
        } else {
          task.stablePolls = 0
        }
      }

      task.lastMsgCount = currentMsgCount
    } catch (error) {
      log("[background-agent] Poll error for task:", { taskId: task.id, error })
    }
  }

  if (!hasRunningTasks()) {
    stopPolling()
  }
}
