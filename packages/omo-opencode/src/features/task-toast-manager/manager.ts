import type { PluginInput } from "@opencode-ai/plugin"
import { t } from "../../shared/i18n"
import type { ConcurrencyManager } from "../background-agent/concurrency"
import type { ModelFallbackInfo, TaskStatus, TrackedTask } from "./types"

type OpencodeClient = PluginInput["client"]

type ClientWithTui = {
  tui?: {
    showToast: (opts: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<unknown>
  }
}

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

  addTask(task: {
    id: string
    sessionID?: string
    description: string
    agent: string
    isBackground: boolean
    status?: TaskStatus
    category?: string
    skills?: string[]
    modelInfo?: ModelFallbackInfo
  }): void {
    const trackedTask: TrackedTask = {
      id: task.id,
      sessionID: task.sessionID,
      description: task.description,
      agent: task.agent,
      status: task.status ?? "running",
      startedAt: new Date(),
      isBackground: task.isBackground,
      category: task.category,
      skills: task.skills,
      modelInfo: task.modelInfo,
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
   * Update model info for a task by session ID
   */
  updateTaskModelBySession(sessionID: string, modelInfo: ModelFallbackInfo): void {
    if (!sessionID) return
    const task = Array.from(this.tasks.values()).find((t) => t.sessionID === sessionID)
    if (!task) return
    if (task.modelInfo?.model === modelInfo.model && task.modelInfo?.type === modelInfo.type) return
    task.modelInfo = modelInfo
    this.showTaskListToast(task)
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

  private getConcurrencyInfo(): string {
    if (!this.concurrencyManager) return ""
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()
    const total = running.length + queued.length
    const limit = this.concurrencyManager.getConcurrencyLimit("default")
    if (limit === Infinity) return ""
    return t("toast.concurrency_info", { total, limit })
  }

  private buildTaskListMessage(newTask: TrackedTask): string {
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()
    const concurrencyInfo = this.getConcurrencyInfo()

    const formatTaskIdentifier = (task: TrackedTask): string => {
      const modelName = task.modelInfo?.model?.split("/").pop()
      if (modelName && task.category) return `${modelName}: ${task.category}`
      if (modelName) return modelName
      if (task.category) return `${task.agent}/${task.category}`
      return task.agent
    }
    const lines: string[] = []

    const isFallback = newTask.modelInfo && (
      newTask.modelInfo.type === "inherited" ||
      newTask.modelInfo.type === "system-default" ||
      newTask.modelInfo.type === "runtime-fallback"
    )
    if (isFallback) {
      const suffixMap: Record<"inherited" | "system-default" | "runtime-fallback", string> = {
        inherited: t("toast.fallback_inherited"),
        "system-default": t("toast.fallback_system_default"),
        "runtime-fallback": t("toast.fallback_runtime"),
      }
      const suffix = suffixMap[newTask.modelInfo!.type as "inherited" | "system-default" | "runtime-fallback"]
      lines.push(t("toast.fallback_prefix", { model: newTask.modelInfo!.model, suffix }))
      lines.push("")
    }

    if (running.length > 0) {
      lines.push(t("toast.task_list_running", { count: running.length }) + concurrencyInfo)
      for (const task of running) {
        const duration = this.formatDuration(task.startedAt)
        const bgIcon = task.isBackground ? "[BG]" : "[RUN]"
        const isNew = task.id === newTask.id ? t("toast.task_list_new") : ""
        const taskId = formatTaskIdentifier(task)
        const skillsInfo = task.skills?.length ? ` [${task.skills.join(", ")}]` : ""
        lines.push(`${bgIcon} ${task.description} (${taskId})${skillsInfo} - ${duration}${isNew}`)
      }
    }

    if (queued.length > 0) {
      if (lines.length > 0) lines.push("")
      lines.push(t("toast.task_list_queued", { count: queued.length }))
      for (const task of queued) {
        const bgIcon = task.isBackground ? "[Q]" : "[W]"
        const taskId = formatTaskIdentifier(task)
        const skillsInfo = task.skills?.length ? ` [${task.skills.join(", ")}]` : ""
        const isNew = task.id === newTask.id ? t("toast.task_list_new") : ""
        lines.push(`${bgIcon} ${task.description} (${taskId})${skillsInfo} - ${t("toast.status_queued")}${isNew}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * Show consolidated toast with all running/queued tasks
   */
  private showTaskListToast(newTask: TrackedTask): void {
    const tuiClient = this.client as ClientWithTui
    if (!tuiClient.tui?.showToast) return

    const message = this.buildTaskListMessage(newTask)
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    const title = newTask.isBackground
      ? t("toast.new_background_task")
      : t("toast.new_task_executed")

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
    const tuiClient = this.client as ClientWithTui
    if (!tuiClient.tui?.showToast) return

    this.removeTask(task.id)

    const remaining = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    let message = t("toast.task_completion_message", { description: task.description, duration: task.duration })
    if (remaining.length > 0 || queued.length > 0) {
      message += `\n\n${t("toast.task_completion_remaining", { running: remaining.length, queued: queued.length })}`
    }

    tuiClient.tui.showToast({
      body: {
        title: t("toast.task_completed"),
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

export function _resetTaskToastManagerForTesting(): void {
  instance = null
}
