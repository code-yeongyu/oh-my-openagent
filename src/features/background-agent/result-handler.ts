import type { BackgroundTask } from "./types"
import type { OpencodeClient, Todo } from "./constants"
import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { log } from "../../shared"
import { getTaskToastManager } from "../task-toast-manager"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../hook-message-injector"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { ConcurrencyManager } from "./concurrency"
import type { TaskStateManager } from "./state"

export interface ResultHandlerContext {
  client: OpencodeClient
  concurrencyManager: ConcurrencyManager
  state: TaskStateManager
}

export async function checkSessionTodos(
  client: OpencodeClient,
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.todo({
      path: { id: sessionID },
    })
    const todos = (response.data ?? response) as Todo[]
    if (!todos || todos.length === 0) return false

    const incomplete = todos.filter(
      (t) => t.status !== "completed" && t.status !== "cancelled"
    )
    return incomplete.length > 0
  } catch {
    return false
  }
}

export async function validateSessionHasOutput(
  client: OpencodeClient,
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
    })

    const messages = response.data ?? []
    
    const hasAssistantOrToolMessage = messages.some(
      (m: { info?: { role?: string } }) => 
        m.info?.role === "assistant" || m.info?.role === "tool"
    )

    if (!hasAssistantOrToolMessage) {
      log("[background-agent] No assistant/tool messages found in session:", sessionID)
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasContent = messages.some((m: any) => {
      if (m.info?.role !== "assistant" && m.info?.role !== "tool") return false
      const parts = m.parts ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return parts.some((p: any) => 
        (p.type === "text" && p.text && p.text.trim().length > 0) ||
        (p.type === "reasoning" && p.text && p.text.trim().length > 0) ||
        p.type === "tool" ||
        (p.type === "tool_result" && p.content && 
          (typeof p.content === "string" ? p.content.trim().length > 0 : p.content.length > 0))
      )
    })

    if (!hasContent) {
      log("[background-agent] Messages exist but no content found in session:", sessionID)
      return false
    }

    return true
  } catch (error) {
    log("[background-agent] Error validating session output:", error)
    return true
  }
}

export function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }
  return null
}

export async function tryCompleteTask(
  task: BackgroundTask,
  source: string,
  ctx: ResultHandlerContext
): Promise<boolean> {
  const { concurrencyManager, state } = ctx

  if (task.status !== "running") {
    log("[background-agent] Task already completed, skipping:", { taskId: task.id, status: task.status, source })
    return false
  }

  task.status = "completed"
  task.completedAt = new Date()

  if (task.concurrencyKey) {
    concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  state.markForNotification(task)

  try {
    await notifyParentSession(task, ctx)
    log(`[background-agent] Task completed via ${source}:`, task.id)
  } catch (err) {
    log("[background-agent] Error in notifyParentSession:", { taskId: task.id, error: err })
  }

  return true
}

export async function notifyParentSession(
  task: BackgroundTask,
  ctx: ResultHandlerContext
): Promise<void> {
  const { client, state } = ctx
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

  const pendingSet = state.pendingByParent.get(task.parentSessionID)
  if (pendingSet) {
    pendingSet.delete(task.id)
    if (pendingSet.size === 0) {
      state.pendingByParent.delete(task.parentSessionID)
    }
  }

  const allComplete = !pendingSet || pendingSet.size === 0
  const remainingCount = pendingSet?.size ?? 0

  const statusText = task.status === "completed" ? "COMPLETED" : "CANCELLED"
  const errorInfo = task.error ? `\n**Error:** ${task.error}` : ""
  
  let notification: string
  let completedTasks: BackgroundTask[] = []
  if (allComplete) {
    completedTasks = Array.from(state.tasks.values())
      .filter(t => t.parentSessionID === task.parentSessionID && t.status !== "running" && t.status !== "pending")
    const completedTasksText = completedTasks
      .map(t => `- \`${t.id}\`: ${t.description}`)
      .join("\n")

    notification = `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${completedTasksText || `- \`${task.id}\`: ${task.description}`}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`
  } else {
    const agentInfo = task.category 
      ? `${task.agent} (${task.category})`
      : task.agent
    notification = `<system-reminder>
[BACKGROUND TASK ${statusText}]
**ID:** \`${task.id}\`
**Description:** ${task.description}
**Agent:** ${agentInfo}
**Duration:** ${duration}${errorInfo}

**${remainingCount} task${remainingCount === 1 ? "" : "s"} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="${task.id}")\` to retrieve this result when ready.
</system-reminder>`
  }

  let agent: string | undefined = task.parentAgent
  let model: { providerID: string; modelID: string } | undefined

  try {
    const messagesResp = await client.session.messages({ path: { id: task.parentSessionID } })
    const messages = (messagesResp.data ?? []) as Array<{
      info?: { agent?: string; model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
    }>
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i].info
      if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
        agent = info.agent ?? task.parentAgent
        model = info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
        break
      }
    }
  } catch {
    const messageDir = getMessageDir(task.parentSessionID)
    const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
    agent = currentMessage?.agent ?? task.parentAgent
    model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
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
    log("[background-agent] Failed to send notification:", error)
  }

  if (allComplete) {
    for (const completedTask of completedTasks) {
      const taskId = completedTask.id
      state.clearCompletionTimer(taskId)
      const timer = setTimeout(() => {
        state.completionTimers.delete(taskId)
        if (state.tasks.has(taskId)) {
          state.clearNotificationsForTask(taskId)
          state.tasks.delete(taskId)
          log("[background-agent] Removed completed task from memory:", taskId)
        }
      }, TASK_CLEANUP_DELAY_MS)
      state.setCompletionTimer(taskId, timer)
    }
  }
}
