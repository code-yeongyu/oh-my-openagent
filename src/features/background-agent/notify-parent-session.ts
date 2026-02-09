import { log } from "../../shared"

import { findNearestMessageWithFields } from "../hook-message-injector"
import { getTaskToastManager } from "../task-toast-manager"

import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { formatDuration } from "./format-duration"
import { isAbortedSessionError } from "./error-classifier"
import { getMessageDir } from "./message-dir"
import { buildBackgroundTaskNotificationText } from "./notification-builder"

import type { BackgroundTask } from "./types"
import type { OpencodeClient } from "./opencode-client"

type AgentModel = { providerID: string; modelID: string }

type MessageInfo = {
  agent?: string
  model?: AgentModel
  providerID?: string
  modelID?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractMessageInfo(message: unknown): MessageInfo {
  if (!isRecord(message)) return {}
  const info = message["info"]
  if (!isRecord(info)) return {}

  const agent = typeof info["agent"] === "string" ? info["agent"] : undefined
  const modelObj = info["model"]
  if (isRecord(modelObj)) {
    const providerID = modelObj["providerID"]
    const modelID = modelObj["modelID"]
    if (typeof providerID === "string" && typeof modelID === "string") {
      return { agent, model: { providerID, modelID } }
    }
  }

  const providerID = info["providerID"]
  const modelID = info["modelID"]
  if (typeof providerID === "string" && typeof modelID === "string") {
    return { agent, model: { providerID, modelID } }
  }

  return { agent }
}

export async function notifyParentSession(args: {
  task: BackgroundTask
  tasks: Map<string, BackgroundTask>
  pendingByParent: Map<string, Set<string>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  clearNotificationsForTask: (taskId: string) => void
  client: OpencodeClient
}): Promise<void> {
  const { task, tasks, pendingByParent, completionTimers, clearNotificationsForTask, client } = args

  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
  log("[background-agent] notifyParentSession called for task:", task.id)

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.showCompletionToast({
      id: task.id,
      description: task.description,
      duration,
    })
  }

  const pendingSet = pendingByParent.get(task.parentSessionID)
  if (pendingSet) {
    pendingSet.delete(task.id)
    if (pendingSet.size === 0) {
      pendingByParent.delete(task.parentSessionID)
    }
  }

  const allComplete = !pendingSet || pendingSet.size === 0
  const remainingCount = pendingSet?.size ?? 0

  const completedTasks = allComplete
    ? Array.from(tasks.values()).filter(
        (t) =>
          t.parentSessionID === task.parentSessionID &&
          t.status !== "running" &&
          t.status !== "pending"
      )
    : []

  const notification = buildBackgroundTaskNotificationText({
    task,
    duration,
    allComplete,
    remainingCount,
    completedTasks,
  })

  let agent: string | undefined = task.parentAgent
  let model: AgentModel | undefined

  try {
    const messagesResp = await client.session.messages({
      path: { id: task.parentSessionID },
    })
    const raw = (messagesResp as { data?: unknown }).data ?? []
    const messages = Array.isArray(raw) ? raw : []

    for (let i = messages.length - 1; i >= 0; i--) {
      const extracted = extractMessageInfo(messages[i])
      if (extracted.agent || extracted.model) {
        agent = extracted.agent ?? task.parentAgent
        model = extracted.model
        break
      }
    }
  } catch (error) {
    if (isAbortedSessionError(error)) {
      log("[background-agent] Parent session aborted, skipping notification:", {
        taskId: task.id,
        parentSessionID: task.parentSessionID,
      })
      return
    }

    const messageDir = getMessageDir(task.parentSessionID)
    const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
    agent = currentMessage?.agent ?? task.parentAgent
    model =
      currentMessage?.model?.providerID && currentMessage?.model?.modelID
        ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
        : undefined
  }

  log("[background-agent] notifyParentSession context:", {
    taskId: task.id,
    resolvedAgent: agent,
    resolvedModel: model,
  })

  try {
    await client.session.promptAsync({
      path: { id: task.parentSessionID },
      body: {
        noReply: !allComplete,
        ...(agent !== undefined ? { agent } : {}),
        ...(model !== undefined ? { model } : {}),
        parts: [{ type: "text", text: notification }],
      },
    })

    log("[background-agent] Sent notification to parent session:", {
      taskId: task.id,
      allComplete,
      noReply: !allComplete,
    })
  } catch (error) {
    if (isAbortedSessionError(error)) {
      log("[background-agent] Parent session aborted, skipping notification:", {
        taskId: task.id,
        parentSessionID: task.parentSessionID,
      })
      return
    }
    log("[background-agent] Failed to send notification:", error)
  }

  if (!allComplete) return

  for (const completedTask of completedTasks) {
    const taskId = completedTask.id
    const existingTimer = completionTimers.get(taskId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      completionTimers.delete(taskId)
    }

    const timer = setTimeout(() => {
      completionTimers.delete(taskId)
      if (tasks.has(taskId)) {
        clearNotificationsForTask(taskId)
        tasks.delete(taskId)
        log("[background-agent] Removed completed task from memory:", taskId)
      }
    }, TASK_CLEANUP_DELAY_MS)

    completionTimers.set(taskId, timer)
  }
}
