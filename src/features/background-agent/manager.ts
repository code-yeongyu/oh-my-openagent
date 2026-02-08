import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import type { BackgroundTaskConfig, TmuxConfig } from "../../config/schema"

import { log } from "../../shared"
import { ConcurrencyManager } from "./concurrency"
import { POLLING_INTERVAL_MS } from "./constants"

import { handleBackgroundEvent } from "./background-event-handler"
import { shutdownBackgroundManager } from "./background-manager-shutdown"
import { clearNotifications, clearNotificationsForTask, cleanupPendingByParent, getPendingNotifications, markForNotification } from "./notification-tracker"
import { notifyParentSession as notifyParentSessionInternal } from "./notify-parent-session"
import { pollRunningTasks } from "./poll-running-tasks"
import { registerProcessSignal, type ProcessCleanupEvent } from "./process-signal"
import { validateSessionHasOutput, checkSessionTodos } from "./session-validator"
import { pruneStaleState } from "./stale-task-pruner"
import { getAllDescendantTasks, getCompletedTasks, getRunningTasks, getTasksByParentSession, hasRunningTasks, findTaskBySession } from "./task-queries"
import { checkAndInterruptStaleTasks } from "./task-poller"
import { cancelBackgroundTask } from "./task-canceller"
import { tryCompleteBackgroundTask } from "./task-completer"
import { launchBackgroundTask } from "./task-launch"
import { processConcurrencyKeyQueue } from "./task-queue-processor"
import { resumeBackgroundTask } from "./task-resumer"
import { startQueuedTask } from "./task-starter"
import { trackExternalTask } from "./task-tracker"

type QueueItem = { task: BackgroundTask; input: LaunchInput }

export interface SubagentSessionCreatedEvent { sessionID: string; parentID: string; title: string }
export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>

export class BackgroundManager {
  private static cleanupManagers = new Set<BackgroundManager>()
  private static cleanupRegistered = false
  private static cleanupHandlers = new Map<ProcessCleanupEvent, () => void>()

  private tasks = new Map<string, BackgroundTask>()
  private notifications = new Map<string, BackgroundTask[]>()
  private pendingByParent = new Map<string, Set<string>>()
  private queuesByKey = new Map<string, QueueItem[]>()
  private processingKeys = new Set<string>()
  private completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private idleDeferralTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private client: PluginInput["client"]
  private directory: string
  private pollingInterval?: ReturnType<typeof setInterval>
  private concurrencyManager: ConcurrencyManager
  private shutdownTriggered = { value: false }
  private config?: BackgroundTaskConfig
  private tmuxEnabled: boolean
  private onSubagentSessionCreated?: OnSubagentSessionCreated
  private onShutdown?: () => void

  constructor(ctx: PluginInput, config?: BackgroundTaskConfig, options?: { tmuxConfig?: TmuxConfig; onSubagentSessionCreated?: OnSubagentSessionCreated; onShutdown?: () => void }) {
    this.client = ctx.client
    this.directory = ctx.directory
    this.concurrencyManager = new ConcurrencyManager(config)
    this.config = config
    this.tmuxEnabled = options?.tmuxConfig?.enabled ?? false
    this.onSubagentSessionCreated = options?.onSubagentSessionCreated
    this.onShutdown = options?.onShutdown
    this.registerProcessCleanup()
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    return launchBackgroundTask({ input, tasks: this.tasks, pendingByParent: this.pendingByParent, queuesByKey: this.queuesByKey, getConcurrencyKeyFromInput: (i) => this.getConcurrencyKeyFromInput(i), processKey: (key) => void this.processKey(key) })
  }

  async trackTask(input: { taskId: string; sessionID: string; parentSessionID: string; description: string; agent?: string; parentAgent?: string; concurrencyKey?: string }): Promise<BackgroundTask> {
    return trackExternalTask({ input, tasks: this.tasks, pendingByParent: this.pendingByParent, concurrencyManager: this.concurrencyManager, startPolling: () => this.startPolling(), cleanupPendingByParent: (task) => this.cleanupPendingByParent(task) })
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    return resumeBackgroundTask({ input, findBySession: (id) => this.findBySession(id), client: this.client, concurrencyManager: this.concurrencyManager, pendingByParent: this.pendingByParent, startPolling: () => this.startPolling(), markForNotification: (task) => this.markForNotification(task), cleanupPendingByParent: (task) => this.cleanupPendingByParent(task), notifyParentSession: (task) => this.notifyParentSession(task) })
  }

  getTask(id: string): BackgroundTask | undefined { return this.tasks.get(id) }
  getTasksByParentSession(sessionID: string): BackgroundTask[] { return getTasksByParentSession(this.tasks.values(), sessionID) }
  getAllDescendantTasks(sessionID: string): BackgroundTask[] { return getAllDescendantTasks((id) => this.getTasksByParentSession(id), sessionID) }
  findBySession(sessionID: string): BackgroundTask | undefined { return findTaskBySession(this.tasks.values(), sessionID) }
  getRunningTasks(): BackgroundTask[] { return getRunningTasks(this.tasks.values()) }
  getCompletedTasks(): BackgroundTask[] { return getCompletedTasks(this.tasks.values()) }

  markForNotification(task: BackgroundTask): void { markForNotification(this.notifications, task) }
  getPendingNotifications(sessionID: string): BackgroundTask[] { return getPendingNotifications(this.notifications, sessionID) }
  clearNotifications(sessionID: string): void { clearNotifications(this.notifications, sessionID) }

  cancelPendingTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "pending") return false
    void this.cancelTask(taskId, { source: "cancelPendingTask", abortSession: false })
    return true
  }

  async cancelTask(taskId: string, options?: { source?: string; reason?: string; abortSession?: boolean; skipNotification?: boolean }): Promise<boolean> {
    return cancelBackgroundTask({ taskId, options, tasks: this.tasks, queuesByKey: this.queuesByKey, completionTimers: this.completionTimers, idleDeferralTimers: this.idleDeferralTimers, concurrencyManager: this.concurrencyManager, client: this.client, cleanupPendingByParent: (task) => this.cleanupPendingByParent(task), markForNotification: (task) => this.markForNotification(task), notifyParentSession: (task) => this.notifyParentSession(task) })
  }

  handleEvent(event: { type: string; properties?: Record<string, unknown> }): void {
    handleBackgroundEvent({ event, findBySession: (id) => this.findBySession(id), getAllDescendantTasks: (id) => this.getAllDescendantTasks(id), cancelTask: (id, opts) => this.cancelTask(id, opts), tryCompleteTask: (task, source) => this.tryCompleteTask(task, source), validateSessionHasOutput: (id) => this.validateSessionHasOutput(id), checkSessionTodos: (id) => this.checkSessionTodos(id), idleDeferralTimers: this.idleDeferralTimers, completionTimers: this.completionTimers, tasks: this.tasks, cleanupPendingByParent: (task) => this.cleanupPendingByParent(task), clearNotificationsForTask: (id) => this.clearNotificationsForTask(id), emitIdleEvent: (sessionID) => this.handleEvent({ type: "session.idle", properties: { sessionID } }) })
  }

  shutdown(): void {
    shutdownBackgroundManager({ shutdownTriggered: this.shutdownTriggered, stopPolling: () => this.stopPolling(), tasks: this.tasks, client: this.client, onShutdown: this.onShutdown, concurrencyManager: this.concurrencyManager, completionTimers: this.completionTimers, idleDeferralTimers: this.idleDeferralTimers, notifications: this.notifications, pendingByParent: this.pendingByParent, queuesByKey: this.queuesByKey, processingKeys: this.processingKeys, unregisterProcessCleanup: () => this.unregisterProcessCleanup() })
  }

  private getConcurrencyKeyFromInput(input: LaunchInput): string { return input.model ? `${input.model.providerID}/${input.model.modelID}` : input.agent }
  private async processKey(key: string): Promise<void> { await processConcurrencyKeyQueue({ key, queuesByKey: this.queuesByKey, processingKeys: this.processingKeys, concurrencyManager: this.concurrencyManager, startTask: (item) => this.startTask(item) }) }
  private async startTask(item: QueueItem): Promise<void> {
    await startQueuedTask({ item, client: this.client, defaultDirectory: this.directory, tmuxEnabled: this.tmuxEnabled, onSubagentSessionCreated: this.onSubagentSessionCreated, startPolling: () => this.startPolling(), getConcurrencyKeyFromInput: (i) => this.getConcurrencyKeyFromInput(i), concurrencyManager: this.concurrencyManager, findBySession: (id) => this.findBySession(id), markForNotification: (task) => this.markForNotification(task), cleanupPendingByParent: (task) => this.cleanupPendingByParent(task), notifyParentSession: (task) => this.notifyParentSession(task) })
  }

  private startPolling(): void {
    if (this.pollingInterval) return
    this.pollingInterval = setInterval(() => void this.pollRunningTasks(), POLLING_INTERVAL_MS)
    this.pollingInterval.unref()
  }
  private stopPolling(): void { if (this.pollingInterval) { clearInterval(this.pollingInterval); this.pollingInterval = undefined } }

  private async pollRunningTasks(): Promise<void> {
    await pollRunningTasks({ tasks: this.tasks.values(), client: this.client, pruneStaleTasksAndNotifications: () => this.pruneStaleTasksAndNotifications(), checkAndInterruptStaleTasks: () => this.checkAndInterruptStaleTasks(), validateSessionHasOutput: (id) => this.validateSessionHasOutput(id), checkSessionTodos: (id) => this.checkSessionTodos(id), tryCompleteTask: (task, source) => this.tryCompleteTask(task, source), hasRunningTasks: () => this.hasRunningTasks(), stopPolling: () => this.stopPolling() })
  }

  private pruneStaleTasksAndNotifications(): void {
    pruneStaleState({ tasks: this.tasks, notifications: this.notifications, concurrencyManager: this.concurrencyManager, cleanupPendingByParent: (task) => this.cleanupPendingByParent(task), clearNotificationsForTask: (id) => this.clearNotificationsForTask(id) })
  }
  private async checkAndInterruptStaleTasks(): Promise<void> {
    await checkAndInterruptStaleTasks({ tasks: this.tasks.values(), client: this.client, config: this.config, concurrencyManager: this.concurrencyManager, notifyParentSession: (task) => this.notifyParentSession(task) })
  }

  private hasRunningTasks(): boolean { return hasRunningTasks(this.tasks.values()) }
  private async tryCompleteTask(task: BackgroundTask, source: string): Promise<boolean> {
    return tryCompleteBackgroundTask({ task, source, concurrencyManager: this.concurrencyManager, idleDeferralTimers: this.idleDeferralTimers, client: this.client, markForNotification: (t) => this.markForNotification(t), cleanupPendingByParent: (t) => this.cleanupPendingByParent(t), notifyParentSession: (t) => this.notifyParentSession(t) })
  }
  private async notifyParentSession(task: BackgroundTask): Promise<void> {
    await notifyParentSessionInternal({ task, tasks: this.tasks, pendingByParent: this.pendingByParent, completionTimers: this.completionTimers, clearNotificationsForTask: (id) => this.clearNotificationsForTask(id), client: this.client })
  }

  private async validateSessionHasOutput(sessionID: string): Promise<boolean> { return validateSessionHasOutput(this.client, sessionID) }
  private async checkSessionTodos(sessionID: string): Promise<boolean> { return checkSessionTodos(this.client, sessionID) }
  private clearNotificationsForTask(taskId: string): void { clearNotificationsForTask(this.notifications, taskId) }
  private cleanupPendingByParent(task: BackgroundTask): void { cleanupPendingByParent(this.pendingByParent, task) }

  private registerProcessCleanup(): void {
    BackgroundManager.cleanupManagers.add(this)
    if (BackgroundManager.cleanupRegistered) return
    BackgroundManager.cleanupRegistered = true
    const cleanupAll = () => { for (const manager of BackgroundManager.cleanupManagers) { try { manager.shutdown() } catch (error) { log("[background-agent] Error during shutdown cleanup:", error) } } }
    const registerSignal = (signal: ProcessCleanupEvent, exitAfter: boolean) => { const listener = registerProcessSignal(signal, cleanupAll, exitAfter); BackgroundManager.cleanupHandlers.set(signal, listener) }
    registerSignal("SIGINT", true); registerSignal("SIGTERM", true); if (process.platform === "win32") registerSignal("SIGBREAK", true)
    registerSignal("beforeExit", false); registerSignal("exit", false)
  }

  private unregisterProcessCleanup(): void {
    BackgroundManager.cleanupManagers.delete(this)
    if (BackgroundManager.cleanupManagers.size > 0) return
    for (const [signal, listener] of BackgroundManager.cleanupHandlers.entries()) process.off(signal, listener)
    BackgroundManager.cleanupHandlers.clear(); BackgroundManager.cleanupRegistered = false
  }
}
