import type { PluginInput } from "@opencode-ai/plugin"
import type {
  BackgroundTask,
  BackgroundTaskStatus,
  LaunchInput,
} from "./types"

type OpencodeClient = PluginInput["client"]

interface SessionInfo {
  id?: string
  parentID?: string
  status?: string
}

interface MessagePartInfo {
  sessionID?: string
  type?: string
  tool?: string
}

interface EventProperties {
  info?: SessionInfo
  sessionID?: string
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
  private storePath: string
  private persistTimer?: Timer
  private pollingInterval?: Timer

  constructor(client: OpencodeClient, storePath: string) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.client = client
    this.storePath = storePath
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
    this.persist()
    this.startPolling()

    this.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: input.agent,
        parts: [{ type: "text", text: input.prompt }],
      },
    }).catch((error) => {
      const existingTask = this.findBySession(sessionID)
      if (existingTask) {
        existingTask.status = "error"
        existingTask.error = String(error)
        existingTask.completedAt = new Date()
        this.persist()
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
        this.persist()
      }
    }

    if (event.type === "session.updated") {
      const info = props?.info as SessionInfo | undefined
      if (!info || typeof info.id !== "string") return
      const sessionID = info.id
      const status = info?.status

      const task = this.findBySession(sessionID)
      if (!task) return

      if (status === "idle" && task.status === "running") {
        task.status = "completed"
        task.completedAt = new Date()
        this.markForNotification(task)
        this.persist()
      }
    }

    if (event.type === "session.deleted") {
      const info = props?.info as SessionInfo | undefined
      if (!info || typeof info.id !== "string") return
      const sessionID = info.id

      const task = this.findBySession(sessionID)
      if (!task) return

      if (task.status === "running") {
        task.status = "cancelled"
        task.completedAt = new Date()
        task.error = "Session deleted (cascade delete from parent)"
      }

      this.tasks.delete(task.id)
      this.persist()

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

    this.client.session.prompt({
      path: { id: task.parentSessionID },
      body: {
        parts: [{ type: "text", text: message }],
      },
    }).catch(() => {
      void 0
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
    for (const task of this.tasks.values()) {
      if (task.status !== "running") continue

      try {
        const infoResult = await this.client.session.get({
          path: { id: task.sessionID },
        })

        if (infoResult.error) {
          task.status = "error"
          task.error = "Session not found"
          task.completedAt = new Date()
          this.persist()
          continue
        }

        const sessionInfo = infoResult.data as { status?: string }

        if (sessionInfo.status === "idle") {
          task.status = "completed"
          task.completedAt = new Date()
          this.markForNotification(task)
          this.persist()
          this.notifyParentSession(task)
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

          if (task.progress) {
            task.progress.toolCalls = toolCalls
            task.progress.lastTool = lastTool
            task.progress.lastUpdate = new Date()
          }
        }
      } catch {
        void 0
      }
    }

    if (!this.hasRunningTasks()) {
      this.stopPolling()
    }
  }

  persist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }

    this.persistTimer = setTimeout(() => {
      const data = Array.from(this.tasks.values())
      const serialized = data.map((task) => ({
        ...task,
        startedAt: task.startedAt.toISOString(),
        completedAt: task.completedAt?.toISOString(),
        progress: task.progress
          ? {
              ...task.progress,
              lastUpdate: task.progress.lastUpdate.toISOString(),
            }
          : undefined,
      }))
      Bun.write(this.storePath, JSON.stringify(serialized, null, 2)).catch(() => {
        void 0
      })
    }, 500)
  }

  async restore(): Promise<void> {
    try {
      const file = Bun.file(this.storePath)
      const exists = await file.exists()
      if (!exists) return

      const content = await file.text()
      const data = JSON.parse(content) as Array<{
        id: string
        sessionID: string
        parentSessionID: string
        parentMessageID: string
        description: string
        agent: string
        status: BackgroundTaskStatus
        startedAt: string
        completedAt?: string
        result?: string
        error?: string
        progress?: {
          toolCalls: number
          lastTool?: string
          lastUpdate: string
        }
      }>

      for (const item of data) {
        const task: BackgroundTask = {
          ...item,
          startedAt: new Date(item.startedAt),
          completedAt: item.completedAt ? new Date(item.completedAt) : undefined,
          progress: item.progress
            ? {
                ...item.progress,
                lastUpdate: new Date(item.progress.lastUpdate),
              }
            : undefined,
        }
        this.tasks.set(task.id, task)
      }

      if (this.hasRunningTasks()) {
        this.startPolling()
      }
    } catch {
      void 0
    }
  }
}
