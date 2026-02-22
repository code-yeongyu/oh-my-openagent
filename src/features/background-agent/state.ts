import type { BackgroundTask, LaunchInput } from "./types"
import type { QueueItem } from "./constants"
import { log } from "../../shared"
import { subagentSessions } from "../claude-code-session-state"
export class TaskStateManager {
  readonly tasks: Map<string, BackgroundTask> = new Map()
  readonly notifications: Map<string, BackgroundTask[]> = new Map()
  readonly pendingByParent: Map<string, Set<string>> = new Map()
  readonly queuesByKey: Map<string, QueueItem[]> = new Map()
  readonly processingKeys: Set<string> = new Set()
  readonly completionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }
  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task
      }
    }
    return undefined
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
      if (child.sessionID) {
        const descendants = this.getAllDescendantTasks(child.sessionID)
        result.push(...descendants)
      }
    }

    return result
  }

  getRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === "running")
  }
  getNonRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status !== "running")
  }

  hasRunningTasks(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === "running") return true
    }
    return false
  }

  getConcurrencyKeyFromInput(input: LaunchInput): string {
    if (input.model) {
      return `${input.model.providerID}/${input.model.modelID}`
    }
    return input.agent
  }

  getConcurrencyKeyFromTask(task: BackgroundTask): string {
    if (task.model) {
      return `${task.model.providerID}/${task.model.modelID}`
    }
    return task.agent
  }

  addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  removeTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task?.sessionID) {
      subagentSessions.delete(task.sessionID)
    }
    this.tasks.delete(taskId)
  }

  trackPendingTask(parentSessionID: string, taskId: string): void {
    const pending = this.pendingByParent.get(parentSessionID) ?? new Set()
    pending.add(taskId)
    this.pendingByParent.set(parentSessionID, pending)
  }

  cleanupPendingByParent(task: BackgroundTask): void {
    if (!task.parentSessionID) return
    const pending = this.pendingByParent.get(task.parentSessionID)
    if (pending) {
      pending.delete(task.id)
      if (pending.size === 0) {
        this.pendingByParent.delete(task.parentSessionID)
      }
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

  clearNotificationsForTask(taskId: string): void {
    for (const [sessionID, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId)
      if (filtered.length === 0) {
        this.notifications.delete(sessionID)
      } else {
        this.notifications.set(sessionID, filtered)
      }
    }
  }

  addToQueue(key: string, item: QueueItem): void {
    const queue = this.queuesByKey.get(key) ?? []
    queue.push(item)
    this.queuesByKey.set(key, queue)
  }

  getQueue(key: string): QueueItem[] | undefined {
    return this.queuesByKey.get(key)
  }

  removeFromQueue(key: string, taskId: string): boolean {
    const queue = this.queuesByKey.get(key)
    if (!queue) return false

    const index = queue.findIndex(item => item.task.id === taskId)
    if (index === -1) return false

    queue.splice(index, 1)
    if (queue.length === 0) {
      this.queuesByKey.delete(key)
    }
    return true
  }

  setCompletionTimer(taskId: string, timer: ReturnType<typeof setTimeout>): void {
    this.completionTimers.set(taskId, timer)
  }

  clearCompletionTimer(taskId: string): void {
    const timer = this.completionTimers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.completionTimers.delete(taskId)
    }
  }

  clearAllCompletionTimers(): void {
    for (const timer of this.completionTimers.values()) {
      clearTimeout(timer)
    }
    this.completionTimers.clear()
  }

  clear(): void {
    this.clearAllCompletionTimers()
    this.tasks.clear()
    this.notifications.clear()
    this.pendingByParent.clear()
    this.queuesByKey.clear()
    this.processingKeys.clear()
  }

  cancelPendingTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "pending") {
      return false
    }

    const key = this.getConcurrencyKeyFromTask(task)
    this.removeFromQueue(key, taskId)

    task.status = "cancelled"
    task.completedAt = new Date()

    this.cleanupPendingByParent(task)

    log("[background-agent] Cancelled pending task:", { taskId, key })
    return true
  }
}
