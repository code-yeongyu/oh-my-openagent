import type { PluginInput } from "@opencode-ai/plugin"
import type { TrackedTask, TaskStatus } from "./types"
import type { ConcurrencyManager } from "../background-agent/concurrency"

type OpencodeClient = PluginInput["client"]

export class TaskToastManager {
  private tasks: Map<string, TrackedTask> = new Map()
  private client: OpencodeClient
  private concurrencyManager?: ConcurrencyManager

  constructor(client: OpencodeClient, concurrencyManager?: ConcurrencyManager) {
    this.client = client
    this.concurrencyManager = concurrencyManager
  }

  setConcurrencyManager(manager: ConcurrencyManager): void {
    this.concurrencyManager = manager
  }

  /**
   * Register a new task and show consolidated toast
   */
  addTask(task: {
    id: string
    description: string
    agent: string
    isBackground: boolean
    status?: TaskStatus
  }): void {
    const trackedTask: TrackedTask = {
      id: task.id,
      description: task.description,
      agent: task.agent,
      status: task.status ?? "running",
      startedAt: new Date(),
      isBackground: task.isBackground,
    }

    this.tasks.set(task.id, trackedTask)
    this.showTaskListToast(trackedTask)
  }

  /**
   * Update task status
   */
  updateTask(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = status
    }
  }

  /**
   * Remove completed/error task
   */
  removeTask(id: string): void {
    this.tasks.delete(id)
  }

  /**
   * Get all running tasks (newest first)
   */
  getRunningTasks(): TrackedTask[] {
    const running = Array.from(this.tasks.values())
      .filter((t) => t.status === "running")
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    return running
  }

  /**
   * Get all queued tasks
   */
  getQueuedTasks(): TrackedTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === "queued")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  }

  /**
   * Format duration since task started
   */
  private formatDuration(startedAt: Date): string {
    const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  /**
   * Build task list message
   */
  private buildTaskListMessage(newTask: TrackedTask): string {
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    const lines: string[] = []

    if (running.length > 0) {
      lines.push(`Running (${running.length}):`)
      for (const task of running) {
        const duration = this.formatDuration(task.startedAt)
        const bgIcon = task.isBackground ? "⚡" : "🔄"
        const isNew = task.id === newTask.id ? " ← NEW" : ""
        lines.push(`${bgIcon} ${task.description} (${task.agent}) - ${duration}${isNew}`)
      }
    }

    if (queued.length > 0) {
      if (lines.length > 0) lines.push("")
      lines.push(`Queued (${queued.length}):`)
      for (const task of queued) {
        const bgIcon = task.isBackground ? "⏳" : "⏸️"
        lines.push(`${bgIcon} ${task.description} (${task.agent})`)
      }
    }

    return lines.join("\n")
  }

  /**
   * Show consolidated toast with all running/queued tasks
   */
  private showTaskListToast(newTask: TrackedTask): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.client as any
    if (!tuiClient.tui?.showToast) return

    const message = this.buildTaskListMessage(newTask)
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    const title = newTask.isBackground
      ? `⚡ New Background Task`
      : `🔄 New Task Executed`

    tuiClient.tui.showToast({
      body: {
        title,
        message: message || `${newTask.description} (${newTask.agent})`,
        variant: "info",
        duration: running.length + queued.length > 2 ? 5000 : 3000,
      },
    }).catch(() => {})
  }

  /**
   * Show task completion toast
   */
  showCompletionToast(task: { id: string; description: string; duration: string }): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.client as any
    if (!tuiClient.tui?.showToast) return

    this.removeTask(task.id)

    const remaining = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    let message = `✅ "${task.description}" finished in ${task.duration}`
    if (remaining.length > 0 || queued.length > 0) {
      message += `\n\nStill running: ${remaining.length} | Queued: ${queued.length}`
    }

    tuiClient.tui.showToast({
      body: {
        title: "Task Completed",
        message,
        variant: "success",
        duration: 5000,
      },
    }).catch(() => {})
  }
}

let instance: TaskToastManager | null = null

export function getTaskToastManager(): TaskToastManager | null {
  return instance
}

export function initTaskToastManager(
  client: OpencodeClient,
  concurrencyManager?: ConcurrencyManager
): TaskToastManager {
  instance = new TaskToastManager(client, concurrencyManager)
  return instance
}
