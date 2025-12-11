import type { PluginInput } from "@opencode-ai/plugin"
import type {
  BackgroundTask,
  LaunchInput,
} from "./types"
import { log } from "../../shared/logger"

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

export class BackgroundManager {
  private tasks: Map<string, BackgroundTask>
  private notifications: Map<string, BackgroundTask[]>
  private client: OpencodeClient
  private pollingInterval?: Timer

  constructor(client: OpencodeClient) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.client = client
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
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

    const task: BackgroundTask = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      description: input.description,
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

    log("[background-agent] Launching task:", { taskId: task.id, sessionID })

    this.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: input.agent,
        parts: [{ type: "text", text: input.prompt }],
      },
    }).catch((error) => {
      log("[background-agent] promptAsync error:", error)
      const existingTask = this.findBySession(sessionID)
      if (existingTask) {
        existingTask.status = "error"
        existingTask.error = String(error)
        existingTask.completedAt = new Date()
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

      task.status = "completed"
      task.completedAt = new Date()
      this.markForNotification(task)
      this.notifyParentSession(task)
      log("[background-agent] Task completed via session.idle event:", task.id)
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
    const toolCalls = task.progress?.toolCalls ?? 0
    
    const message = `✅ **Background task completed!**

**Task ID:** ${task.id}
**Description:** ${task.description}
**Duration:** ${duration}
**Tool calls:** ${toolCalls}

Use \`background_result\` tool with taskId="${task.id}" to retrieve the full result.`

    log("[background-agent] Notifying parent session:", task.parentSessionID)
    
    this.client.session.promptAsync({
      path: { id: task.parentSessionID },
      body: {
        parts: [{ type: "text", text: message }],
      },
    }).then(() => {
      log("[background-agent] Parent session notified successfully")
    }).catch((error) => {
      log("[background-agent] Failed to notify parent session:", error)
    })
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
          log("[background-agent] Session not found in status:", task.sessionID)
          continue
        }

        if (sessionStatus.type === "idle") {
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
            parts?: Array<{ type?: string; tool?: string; name?: string }>
          }>
          const assistantMsgs = messages.filter(
            (m) => m.info?.role === "assistant"
          )

          let toolCalls = 0
          let lastTool: string | undefined

          for (const msg of assistantMsgs) {
            const parts = msg.parts ?? []
            for (const part of parts) {
              if (part.type === "tool_use" || part.tool) {
                toolCalls++
                lastTool = part.tool || part.name || "unknown"
              }
            }
          }

          if (!task.progress) {
            task.progress = { toolCalls: 0, lastUpdate: new Date() }
          }
          task.progress.toolCalls = toolCalls
          task.progress.lastTool = lastTool
          task.progress.lastUpdate = new Date()
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
