
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
const MIN_STABILITY_TIME_MS = 10 * 1000  // Must run at least 10s before stability detection kicks in

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
  private pendingByParent: Map<string, Set<string>>  // Track pending tasks per parent for batching
  private client: OpencodeClient
  private directory: string
  private pollingInterval?: ReturnType<typeof setInterval>
  private concurrencyManager: ConcurrencyManager

  constructor(ctx: PluginInput, config?: BackgroundTaskConfig) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.pendingByParent = new Map()
    this.client = ctx.client
    this.directory = ctx.directory
    this.concurrencyManager = new ConcurrencyManager(config)
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    log("[background-agent] launch() called with:", {
      agent: input.agent,
      model: input.model,
      description: input.description,
      parentSessionID: input.parentSessionID,
    })

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    const concurrencyKey = input.agent

    await this.concurrencyManager.acquire(concurrencyKey)

    const parentSession = await this.client.session.get({
      path: { id: input.parentSessionID },
    }).catch((err) => {
      log(`[background-agent] Failed to get parent session: ${err}`)
      return null
    })
    const parentDirectory = parentSession?.data?.directory ?? this.directory
    log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`)

    const createResult = await this.client.session.create({
      body: {
        parentID: input.parentSessionID,
        title: `Background: ${input.description}`,
      },
      query: {
        directory: parentDirectory,
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
      parentAgent: input.parentAgent,
      model: input.model,
      concurrencyKey,
    }

    this.tasks.set(task.id, task)
    this.startPolling()

    // Track for batched notifications
    const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
    pending.add(task.id)
    this.pendingByParent.set(input.parentSessionID, pending)

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

    log("[background-agent] Calling prompt (fire-and-forget) for launch with:", {
      sessionID,
      agent: input.agent,
      model: input.model,
      hasSkillContent: !!input.skillContent,
      promptLength: input.prompt.length,
    })

    // Use prompt() instead of promptAsync() to properly initialize agent loop (fire-and-forget)
    // Include model if caller provided one (e.g., from Sisyphus category configs)
    this.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: input.agent,
        ...(input.model ? { model: input.model } : {}),
        system: input.skillContent,
        tools: {
          task: false,
          sisyphus_task: false,
          call_omo_agent: true,
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
        this.notifyParentSession(existingTask).catch(err => {
          log("[background-agent] Failed to notify on error:", err)
        })
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
    parentAgent?: string
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
      parentAgent: input.parentAgent,
    }

    this.tasks.set(task.id, task)
    subagentSessions.add(input.sessionID)
    this.startPolling()

    // Track for batched notifications (external tasks need tracking too)
    const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
    pending.add(task.id)
    this.pendingByParent.set(input.parentSessionID, pending)

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
    existingTask.parentAgent = input.parentAgent

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }

    this.startPolling()
    subagentSessions.add(existingTask.sessionID)

    // Track for batched notifications (P2 fix: resumed tasks need tracking too)
    const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
    pending.add(existingTask.id)
    this.pendingByParent.set(input.parentSessionID, pending)

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

    log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
      sessionID: existingTask.sessionID,
      agent: existingTask.agent,
      promptLength: input.prompt.length,
    })

    // Note: Don't pass model in body - use agent's configured model instead
    // Use prompt() instead of promptAsync() to properly initialize agent loop
    this.client.session.prompt({
      path: { id: existingTask.sessionID },
      body: {
        agent: existingTask.agent,
        tools: {
          task: false,
          sisyphus_task: false,
          call_omo_agent: true,
        },
        parts: [{ type: "text", text: input.prompt }],
      },
    }).catch((error) => {
      log("[background-agent] resume prompt error:", error)
      existingTask.status = "error"
      const errorMessage = error instanceof Error ? error.message : String(error)
      existingTask.error = errorMessage
      existingTask.completedAt = new Date()
      this.markForNotification(existingTask)
      this.notifyParentSession(existingTask).catch(err => {
        log("[background-agent] Failed to notify on resume error:", err)
      })
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

      // Edge guard: Require minimum elapsed time (5 seconds) before accepting idle
      const elapsedMs = Date.now() - task.startedAt.getTime()
      const MIN_IDLE_TIME_MS = 5000
      if (elapsedMs < MIN_IDLE_TIME_MS) {
        log("[background-agent] Ignoring early session.idle, elapsed:", { elapsedMs, taskId: task.id })
        return
      }

      // Edge guard: Verify session has actual assistant output before completing
      this.validateSessionHasOutput(sessionID).then(async (hasValidOutput) => {
        if (!hasValidOutput) {
          log("[background-agent] Session.idle but no valid output yet, waiting:", task.id)
          return
        }

        const hasIncompleteTodos = await this.checkSessionTodos(sessionID)
        if (hasIncompleteTodos) {
          log("[background-agent] Task has incomplete todos, waiting for todo-continuation:", task.id)
          return
        }

        task.status = "completed"
        task.completedAt = new Date()
        this.markForNotification(task)
        await this.notifyParentSession(task)
        log("[background-agent] Task completed via session.idle event:", task.id)
      }).catch(err => {
        log("[background-agent] Error in session.idle handler:", err)
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

  /**
   * Validates that a session has actual assistant/tool output before marking complete.
   * Prevents premature completion when session.idle fires before agent responds.
   */
  private async validateSessionHasOutput(sessionID: string): Promise<boolean> {
    try {
      const response = await this.client.session.messages({
        path: { id: sessionID },
      })

      const messages = response.data ?? []
      
      // Check for at least one assistant or tool message
      const hasAssistantOrToolMessage = messages.some(
        (m: { info?: { role?: string } }) => 
          m.info?.role === "assistant" || m.info?.role === "tool"
      )

      if (!hasAssistantOrToolMessage) {
        log("[background-agent] No assistant/tool messages found in session:", sessionID)
        return false
      }

      // Additionally check that at least one message has content (not just empty)
      // OpenCode API uses different part types than Anthropic's API:
      // - "reasoning" with .text property (thinking/reasoning content)
      // - "tool" with .state.output property (tool call results)
      // - "text" with .text property (final text output)
      // - "step-start"/"step-finish" (metadata, no content)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasContent = messages.some((m: any) => {
        if (m.info?.role !== "assistant" && m.info?.role !== "tool") return false
        const parts = m.parts ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return parts.some((p: any) => 
        // Text content (final output)
        (p.type === "text" && p.text && p.text.trim().length > 0) ||
        // Reasoning content (thinking blocks)
        (p.type === "reasoning" && p.text && p.text.trim().length > 0) ||
        // Tool calls (indicates work was done)
        p.type === "tool" ||
        // Tool results (output from executed tools) - important for tool-only tasks
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
      // On error, allow completion to proceed (don't block indefinitely)
      return true
    }
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
    this.pendingByParent.clear()
  }

  /**
   * Get all running tasks (for compaction hook)
   */
  getRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === "running")
  }

  /**
   * Get all completed tasks still in memory (for compaction hook)
   */
  getCompletedTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status !== "running")
  }

private async notifyParentSession(task: BackgroundTask): Promise<void> {
    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    const duration = this.formatDuration(task.startedAt, task.completedAt)

    log("[background-agent] notifyParentSession called for task:", task.id)

    // Show toast notification
    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.showCompletionToast({
        id: task.id,
        description: task.description,
        duration,
      })
    }

    // Update pending tracking and check if all tasks complete
    const pendingSet = this.pendingByParent.get(task.parentSessionID)
    if (pendingSet) {
      pendingSet.delete(task.id)
      if (pendingSet.size === 0) {
        this.pendingByParent.delete(task.parentSessionID)
      }
    }

    const allComplete = !pendingSet || pendingSet.size === 0
    const remainingCount = pendingSet?.size ?? 0

    // Build notification message
    const statusText = task.status === "error" ? "FAILED" : "COMPLETED"
    const errorInfo = task.error ? `\n**Error:** ${task.error}` : ""
    
    let notification: string
    if (allComplete) {
      // All tasks complete - build summary
      const completedTasks = Array.from(this.tasks.values())
        .filter(t => t.parentSessionID === task.parentSessionID && t.status !== "running")
        .map(t => `- \`${t.id}\`: ${t.description}`)
        .join("\n")

      notification = `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${completedTasks || `- \`${task.id}\`: ${task.description}`}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`
    } else {
      // Individual completion - silent notification
      notification = `<system-reminder>
[BACKGROUND TASK ${statusText}]
**ID:** \`${task.id}\`
**Description:** ${task.description}
**Duration:** ${duration}${errorInfo}

**${remainingCount} task${remainingCount === 1 ? "" : "s"} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="${task.id}")\` to retrieve this result when ready.
</system-reminder>`
    }

    // Inject notification via session.prompt with noReply
    // Don't pass model - let OpenCode use session's existing lastModel (like todo-continuation)
    // This prevents model switching when parentModel is undefined
    try {
      await this.client.session.prompt({
        path: { id: task.parentSessionID },
        body: {
          noReply: !allComplete,
          ...(task.parentAgent !== undefined ? { agent: task.parentAgent } : {}),
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

    const taskId = task.id
    setTimeout(() => {
      this.clearNotificationsForTask(taskId)
      this.tasks.delete(taskId)
      log("[background-agent] Removed completed task from memory:", taskId)
    }, 5 * 60 * 1000)
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
        
        // Don't skip if session not in status - fall through to message-based detection
        if (sessionStatus?.type === "idle") {
          // Edge guard: Validate session has actual output before completing
          const hasValidOutput = await this.validateSessionHasOutput(task.sessionID)
          if (!hasValidOutput) {
            log("[background-agent] Polling idle but no valid output yet, waiting:", task.id)
            continue
          }

          const hasIncompleteTodos = await this.checkSessionTodos(task.sessionID)
          if (hasIncompleteTodos) {
            log("[background-agent] Task has incomplete todos via polling, waiting:", task.id)
            continue
          }

          task.status = "completed"
          task.completedAt = new Date()
          this.markForNotification(task)
          await this.notifyParentSession(task)
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

          // Stability detection: complete when message count unchanged for 3 polls
          const currentMsgCount = messages.length
          const elapsedMs = Date.now() - task.startedAt.getTime()

          if (elapsedMs >= MIN_STABILITY_TIME_MS) {
            if (task.lastMsgCount === currentMsgCount) {
              task.stablePolls = (task.stablePolls ?? 0) + 1
              if (task.stablePolls >= 3) {
                // Edge guard: Validate session has actual output before completing
                const hasValidOutput = await this.validateSessionHasOutput(task.sessionID)
                if (!hasValidOutput) {
                  log("[background-agent] Stability reached but no valid output, waiting:", task.id)
                  continue
                }

                const hasIncompleteTodos = await this.checkSessionTodos(task.sessionID)
                if (!hasIncompleteTodos) {
                  task.status = "completed"
                  task.completedAt = new Date()
                  this.markForNotification(task)
                  await this.notifyParentSession(task)
                  log("[background-agent] Task completed via stability detection:", task.id)
                  continue
                }
              }
            } else {
              task.stablePolls = 0
            }
          }
          task.lastMsgCount = currentMsgCount
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
