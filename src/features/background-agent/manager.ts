import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type {
  BackgroundTask,
  LaunchInput,
} from "./types"
import { log } from "../../shared/logger"
import { setSessionAgent, clearSessionAgent } from "../claude-code-session-state/agent-registry"
import {
  findNearestMessageWithFields,
  MESSAGE_STORAGE,
} from "../hook-message-injector"
import { getToolConfigForRole } from "../../config/tool-config"
import { AGENT_ROLE_REGISTRY } from "../../agents"

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

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

export class BackgroundManager {
  private tasks: Map<string, BackgroundTask>
  private notifications: Map<string, BackgroundTask[]>
  private client: OpencodeClient
  private directory: string
  private pollingInterval?: Timer

  constructor(ctx: PluginInput) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.client = ctx.client
    this.directory = ctx.directory
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    const createResult = await this.client.session.create({
      body: {
        parentID: input.parentSessionID,
        title: `Background: ${input.description}`,
      },
    })

    if (createResult.error) {
      throw new Error(`Failed to create background session: ${createResult.error}`)
    }

    const sessionID = createResult.data.id

    // LIF-70: Register session agent for governance hooks to identify allowed agents
    setSessionAgent(sessionID, input.agent)

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
    }

    this.tasks.set(task.id, task)
    this.startPolling()

    log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: input.agent })

    // LIF-62: Get role-based tool restrictions for the target agent
    const agentRole = AGENT_ROLE_REGISTRY[input.agent] ?? "specialist"
    const toolConfig = getToolConfigForRole(agentRole)
    
    log(`[background-agent] Applying role-based config for ${input.agent} (role: ${agentRole})`)

    // Use session.prompt() instead of promptAsync() so the TUI can track/display
    // tool calls from background sessions. We don't await it, so it runs in
    // the background while the main session continues.
    this.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: input.agent,
        tools: {
          // Apply role-based restrictions from tool-config.ts
          task: toolConfig.task ?? false,
          call_omo_agent: toolConfig.call_omo_agent ?? false,
          background_task: toolConfig.background_task ?? false,
          write: toolConfig.write ?? true,
          edit: toolConfig.edit ?? true,
        },
        parts: [{ type: "text", text: input.prompt }],
      },
    }).catch((error) => {
      log("[background-agent] prompt error:", error)
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

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task
      }
    }
    return undefined
  }

  private async hasRunningTools(sessionID: string): Promise<boolean> {
    try {
      const messagesResult = await this.client.session.messages({ path: { id: sessionID } })
      if (messagesResult.error || !messagesResult.data) return false
      
      const messages = messagesResult.data as Array<{
        info?: { role?: string; time?: { completed?: number } }
        parts?: Array<{ type?: string; state?: { status?: string } }>
      }>
      
      if (messages.length === 0) return false
      
      for (const message of messages) {
        for (const part of message.parts ?? []) {
          if (part.type === "tool" && part.state?.status) {
            if (part.state.status === "pending" || part.state.status === "running") {
              log("[background-agent] Found running tool:", { sessionID, status: part.state.status })
              return true
            }
          }
        }
      }
      
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.info?.role === "user") {
        log("[background-agent] Last message is USER - session working:", { sessionID })
        return true
      }
      
      const lastAssistant = messages.filter(m => m.info?.role === "assistant").pop()
      if (lastAssistant && !lastAssistant.info?.time?.completed) {
        log("[background-agent] Assistant message not completed:", { sessionID })
        return true
      }
      
      return false
    } catch {
      return false
    }
  }

  private async hasRunningDescendants(sessionID: string, depth = 0, maxDepth = 5): Promise<boolean> {
    if (depth > maxDepth) {
      log("[background-agent] Max recursion depth reached:", { sessionID })
      return false
    }
    
    if (await this.hasRunningTools(sessionID)) {
      return true
    }
    
    try {
      const childrenResult = await this.client.session.children({ path: { id: sessionID } })
      if (childrenResult.error || !childrenResult.data) return false
      
      const children = childrenResult.data as Array<{ id: string }>
      
      for (const child of children) {
        if (await this.hasRunningDescendants(child.id, depth + 1, maxDepth)) {
          log("[background-agent] Descendant still running:", { childID: child.id, depth: depth + 1 })
          return true
        }
      }
    } catch (error) {
      log("[background-agent] Error checking children:", { sessionID, error })
    }
    
    return false
  }

  private async checkSessionCompletionViaMessages(sessionID: string): Promise<boolean> {
    const hasRunning = await this.hasRunningDescendants(sessionID)
    return !hasRunning
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

      this.tasks.delete(task.id)
      this.clearNotificationsForTask(task.id)
      clearSessionAgent(sessionID)
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
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = undefined
    }
  }

  private notifyParentSession(task: BackgroundTask): void {
    const duration = this.formatDuration(task.startedAt, task.completedAt)

    log("[background-agent] notifyParentSession called for task:", task.id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.client as any
    if (tuiClient.tui?.showToast) {
      tuiClient.tui.showToast({
        body: {
          title: "Background Task Completed",
          message: `@${task.agent}: "${task.description}" finished in ${duration}.`,
          variant: "success",
          duration: 5000,
        },
      }).catch(() => {})
    }

    const message = `[BACKGROUND TASK COMPLETED] Agent @${task.agent}: "${task.description}" finished in ${duration}. Use background_output with task_id="${task.id}" to get results.`

    log("[background-agent] Sending notification to parent session:", { parentSessionID: task.parentSessionID })

    setTimeout(async () => {
      try {
        const messageDir = getMessageDir(task.parentSessionID)
        const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null

        await this.client.session.prompt({
          path: { id: task.parentSessionID },
          body: {
            agent: prevMessage?.agent,
            parts: [{ type: "text", text: message }],
          },
          query: { directory: this.directory },
        })
        this.clearNotificationsForTask(task.id)
        log("[background-agent] Successfully sent prompt to parent session:", { parentSessionID: task.parentSessionID })
      } catch (error) {
        log("[background-agent] prompt failed:", String(error))
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

  private async pollRunningTasks(): Promise<void> {
    const statusResult = await this.client.session.status()
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>

    for (const task of this.tasks.values()) {
      if (task.status !== "running") continue

      try {
        const sessionStatus = allStatuses[task.sessionID]
        
        if (!sessionStatus) {
          log("[background-agent] Session not in status, checking messages:", task.sessionID)
          
          const completed = await this.checkSessionCompletionViaMessages(task.sessionID)
          if (completed) {
            const hasIncompleteTodos = await this.checkSessionTodos(task.sessionID)
            if (hasIncompleteTodos) {
              log("[background-agent] Child session has incomplete todos:", task.id)
              continue
            }
            
            task.status = "completed"
            task.completedAt = new Date()
            this.markForNotification(task)
            this.notifyParentSession(task)
            log("[background-agent] Child session completed:", task.id)
          }
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
