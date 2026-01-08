
import type { PluginInput } from "@opencode-ai/plugin"
import type {
  BackgroundTask,
  LaunchInput,
  ResumeInput,
} from "./types"
import { log } from "../../shared/logger"
import { ConcurrencyManager } from "./concurrency"
import type { BackgroundTaskConfig } from "../../config/schema"

import { subagentSessions } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"

const TASK_TTL_MS = 30 * 60 * 1000

type OpencodeClient = PluginInput["client"]

interface MessagePartInfo {
  sessionID?: string
  type?: string
  tool?: string
}

interface EventProperties {
  sessionID?: string
  info?: { id?: string }
  [key: string]: unknown
}

interface Event {
  type: string
  properties?: EventProperties
}

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

export class BackgroundManager {
  private tasks: Map<string, BackgroundTask>
  private notifications: Map<string, BackgroundTask[]>
  private client: OpencodeClient
  private directory: string
  private pollingInterval?: ReturnType<typeof setInterval>
  private concurrencyManager: ConcurrencyManager

  constructor(ctx: PluginInput, config?: BackgroundTaskConfig) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.client = ctx.client
    this.directory = ctx.directory
    this.concurrencyManager = new ConcurrencyManager(config)
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    const concurrencyKey = input.agent

    await this.concurrencyManager.acquire(concurrencyKey)

    const createResult = await this.client.session.create({
      body: {
        parentID: input.parentSessionID,
        title: `Background: ${input.description}`,
      },
    }).catch((error) => {
      this.concurrencyManager.release(concurrencyKey)
      throw error
    })

    if (createResult.error) {
      this.concurrencyManager.release(concurrencyKey)
      throw new Error(`Failed to create background session: ${createResult.error}`)
    }

    const sessionID = createResult.data.id
    subagentSessions.add(sessionID)

    const task: BackgroundTask = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      status: "running",
      startedAt: new Date(),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
      parentModel: input.parentModel,
      model: input.model,
      concurrencyKey,
    }

    this.tasks.set(task.id, task)
    this.startPolling()

    log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: input.agent })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: input.description,
        agent: input.agent,
        isBackground: true,
        skills: input.skills,
      })
    }

    this.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: input.agent,
        system: input.skillContent,
        tools: {
          task: false,
          call_omo_agent: false,
        },
        parts: [{ type: "text", text: input.prompt }],
      },
    }).catch((error) => {
      log("[background-agent] promptAsync error:", error)
      const existingTask = this.findBySession(sessionID)
      if (existingTask) {
        existingTask.status = "error"
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
          existingTask.error = `Agent "${input.agent}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`
        } else {
          existingTask.error = errorMessage
        }
        existingTask.completedAt = new Date()
        if (existingTask.concurrencyKey) {
          this.concurrencyManager.release(existingTask.concurrencyKey)
        }
        this.markForNotification(existingTask)
        this.notifyParentSession(existingTask)
      }
    })

    return task
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) {
        result.push(task)
      }
    }
    return result
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)

    for (const child of directChildren) {
      result.push(child)
      const descendants = this.getAllDescendantTasks(child.sessionID)
      result.push(...descendants)
    }

    return result
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task
      }
    }
    return undefined
  }

  /**
   * Register an external task (e.g., from sisyphus_task) for notification tracking.
   * This allows tasks created by external tools to receive the same toast/prompt notifications.
   */
  registerExternalTask(input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
  }): BackgroundTask {
    const task: BackgroundTask = {
      id: input.taskId,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: "",
      description: input.description,
      prompt: "",
      agent: input.agent || "sisyphus_task",
      status: "running",
      startedAt: new Date(),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
    }

    this.tasks.set(task.id, task)
    subagentSessions.add(input.sessionID)
    this.startPolling()

    log("[background-agent] Registered external task:", { taskId: task.id, sessionID: input.sessionID })

    return task
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }

    this.startPolling()
    subagentSessions.add(existingTask.sessionID)

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: existingTask.id,
        description: existingTask.description,
        agent: existingTask.agent,
        isBackground: true,
      })
    }

    log("[background-agent] Resuming task:", { taskId: existingTask.id, sessionID: existingTask.sessionID })

    this.client.session.promptAsync({
      path: { id: existingTask.sessionID },
      body: {
        agent: existingTask.agent,
        tools: {
          task: false,
          call_omo_agent: false,
        },
        parts: [{ type: "text", text: input.prompt }],
      },
    }).catch((error) => {
      log("[background-agent] resume promptAsync error:", error)
      existingTask.status = "error"
      const errorMessage = error instanceof Error ? error.message : String(error)
      existingTask.error = errorMessage
      existingTask.completedAt = new Date()
      this.markForNotification(existingTask)
      this.notifyParentSession(existingTask)
    })

    return existingTask
  }

  private async checkSessionTodos(sessionID: string): Promise<boolean> {
    try {
      const response = await this.client.session.todo({
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

  handleEvent(event: Event): void {
    const props = event.properties

    if (event.type === "message.part.updated") {
      if (!props || typeof props !== "object" || !("sessionID" in props)) return
      const partInfo = props as unknown as MessagePartInfo
      const sessionID = partInfo?.sessionID
      if (!sessionID) return

      const task = this.findBySession(sessionID)
      if (!task) return

      if (partInfo?.type === "tool" || partInfo?.tool) {
        if (!task.progress) {
          task.progress = {
            toolCalls: 0,
            lastUpdate: new Date(),
          }
        }
        task.progress.toolCalls += 1
        task.progress.lastTool = partInfo.tool
        task.progress.lastUpdate = new Date()
      }
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const task = this.findBySession(sessionID)
      if (!task || task.status !== "running") return

      this.checkSessionTodos(sessionID).then((hasIncompleteTodos) => {
        if (hasIncompleteTodos) {
          log("[background-agent] Task has incomplete todos, waiting for todo-continuation:", task.id)
          return
        }

        task.status = "completed"
        task.completedAt = new Date()
        this.markForNotification(task)
        this.notifyParentSession(task)
        log("[background-agent] Task completed via session.idle event:", task.id)
      })
    }

    if (event.type === "session.deleted") {
      const info = props?.info
      if (!info || typeof info.id !== "string") return
      const sessionID = info.id

      const task = this.findBySession(sessionID)
      if (!task) return

      if (task.status === "running") {
        task.status = "cancelled"
        task.completedAt = new Date()
        task.error = "Session deleted"
      }

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
      }
      this.tasks.delete(task.id)
      this.clearNotificationsForTask(task.id)
      subagentSessions.delete(sessionID)
    }
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.notifications.get(sessionID) ?? []
  }

  clearNotifications(sessionID: string): void {
    this.notifications.delete(sessionID)
  }

  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionID, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId)
      if (filtered.length === 0) {
        this.notifications.delete(sessionID)
      } else {
        this.notifications.set(sessionID, filtered)
      }
    }
  }

  private startPolling(): void {
    if (this.pollingInterval) return

    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks()
    }, 2000)
    this.pollingInterval.unref()
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = undefined
    }
  }

  cleanup(): void {
    this.stopPolling()
    this.tasks.clear()
    this.notifications.clear()
  }

  private notifyParentSession(task: BackgroundTask): void {
    const duration = this.formatDuration(task.startedAt, task.completedAt)

    log("[background-agent] notifyParentSession called for task:", task.id)

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.showCompletionToast({
        id: task.id,
        description: task.description,
        duration,
      })
    }

    const message = `[BACKGROUND TASK COMPLETED] Task "${task.description}" finished in ${duration}. Use background_output with task_id="${task.id}" to get results.`

    log("[background-agent] Sending notification to parent session:", { parentSessionID: task.parentSessionID })

    const taskId = task.id
    setTimeout(async () => {
      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
      }

      try {
        // Use only parentModel - don't fallback to prevMessage.model
        // This prevents accidentally changing parent session's model
        const modelField = task.parentModel?.providerID && task.parentModel?.modelID
          ? { providerID: task.parentModel.providerID, modelID: task.parentModel.modelID }
          : undefined

        await this.client.session.prompt({
          path: { id: task.parentSessionID },
          body: {
            model: modelField,
            parts: [{ type: "text", text: message }],
          },
          query: { directory: this.directory },
        })
        log("[background-agent] Successfully sent prompt to parent session:", { parentSessionID: task.parentSessionID })
      } catch (error) {
        log("[background-agent] prompt failed:", String(error))
      } finally {
        this.clearNotificationsForTask(taskId)
        this.tasks.delete(taskId)
        log("[background-agent] Removed completed task from memory:", taskId)
      }
    }, 200)
  }

  private formatDuration(start: Date, end?: Date): string {
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

  private hasRunningTasks(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === "running") return true
    }
    return false
  }

  private pruneStaleTasksAndNotifications(): void {
    const now = Date.now()

    for (const [taskId, task] of this.tasks.entries()) {
      const age = now - task.startedAt.getTime()
      if (age > TASK_TTL_MS) {
        log("[background-agent] Pruning stale task:", { taskId, age: Math.round(age / 1000) + "s" })
        task.status = "error"
        task.error = "Task timed out after 30 minutes"
        task.completedAt = new Date()
        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey)
        }
        this.clearNotificationsForTask(taskId)
        this.tasks.delete(taskId)
        subagentSessions.delete(task.sessionID)
      }
    }

    for (const [sessionID, notifications] of this.notifications.entries()) {
      if (notifications.length === 0) {
        this.notifications.delete(sessionID)
        continue
      }
      const validNotifications = notifications.filter((task) => {
        const age = now - task.startedAt.getTime()
        return age <= TASK_TTL_MS
      })
      if (validNotifications.length === 0) {
        this.notifications.delete(sessionID)
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionID, validNotifications)
      }
    }
  }

  private async pollRunningTasks(): Promise<void> {
    this.pruneStaleTasksAndNotifications()

    const statusResult = await this.client.session.status()
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>

    for (const task of this.tasks.values()) {
      if (task.status !== "running") continue

      try {
        const sessionStatus = allStatuses[task.sessionID]
        
        if (!sessionStatus) {
          log("[background-agent] Session not found in status:", task.sessionID)
          continue
        }

        if (sessionStatus.type === "idle") {
          const hasIncompleteTodos = await this.checkSessionTodos(task.sessionID)
          if (hasIncompleteTodos) {
            log("[background-agent] Task has incomplete todos via polling, waiting:", task.id)
            continue
          }

          task.status = "completed"
          task.completedAt = new Date()
          this.markForNotification(task)
          this.notifyParentSession(task)
          log("[background-agent] Task completed via polling:", task.id)
          continue
        }

        const messagesResult = await this.client.session.messages({
          path: { id: task.sessionID },
        })

        if (!messagesResult.error && messagesResult.data) {
          const messages = messagesResult.data as Array<{
            info?: { role?: string }
            parts?: Array<{ type?: string; tool?: string; name?: string; text?: string }>
          }>
          const assistantMsgs = messages.filter(
            (m) => m.info?.role === "assistant"
          )

          let toolCalls = 0
          let lastTool: string | undefined
          let lastMessage: string | undefined

          for (const msg of assistantMsgs) {
            const parts = msg.parts ?? []
            for (const part of parts) {
              if (part.type === "tool_use" || part.tool) {
                toolCalls++
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
        }
      } catch (error) {
        log("[background-agent] Poll error for task:", { taskId: task.id, error })
      }
    }

    if (!this.hasRunningTasks()) {
      this.stopPolling()
    }
  }
}
