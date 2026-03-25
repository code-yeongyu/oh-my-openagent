
import type { PluginInput } from "@opencode-ai/plugin"
import type {
  BackgroundTask,
  LaunchInput,
  ResumeInput,
} from "./types"
import { TaskHistory } from "./task-history"
import {
  log,
  getAgentToolRestrictions,
  normalizePromptTools,
  normalizeSDKResponse,
  promptWithModelSuggestionRetry,
  resolveInheritedPromptTools,
  createInternalAgentTextPart,
} from "../../shared"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { setSessionTools } from "../../shared/session-tools-store"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { ConcurrencyManager } from "./concurrency"
import type { BackgroundTaskConfig, TmuxConfig } from "../../config/schema"
import { isInsideTmux } from "../../shared/tmux"
import {
  shouldRetryError,
  hasMoreFallbacks,
} from "../../shared/model-error-classifier"
import {
  POLLING_INTERVAL_MS,
  TASK_CLEANUP_DELAY_MS,
  TASK_TTL_MS,
} from "./constants"

import { subagentSessions } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"
import { formatDuration } from "./duration-formatter"
import {
  isAbortedSessionError,
  extractErrorName,
  extractErrorMessage,
  getSessionErrorMessage,
  isRecord,
} from "./error-classifier"
import { tryFallbackRetry } from "./fallback-retry-handler"
import { registerManagerForCleanup, unregisterManagerForCleanup } from "./process-cleanup"
import {
  findNearestMessageExcludingCompaction,
  resolvePromptContextFromSessionMessages,
} from "./compaction-aware-message-resolver"
import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"
import { MESSAGE_STORAGE } from "../hook-message-injector"
import { join } from "node:path"
import { pruneStaleTasksAndNotifications } from "./task-poller"
import { checkAndInterruptStaleTasks } from "./task-poller"
import { removeTaskToastTracking } from "./remove-task-toast-tracking"
import { isActiveSessionStatus, isTerminalSessionStatus } from "./session-status-classifier"
import {
  detectRepetitiveToolUse,
  recordToolCall,
  resolveCircuitBreakerSettings,
  type CircuitBreakerSettings,
} from "./loop-detector"
import {
  createSubagentDepthLimitError,
  createSubagentDescendantLimitError,
  getMaxRootSessionSpawnBudget,
  getMaxSubagentDepth,
  resolveSubagentSpawnContext,
  type SubagentSpawnContext,
} from "./subagent-spawn-limits"

type OpencodeClient = PluginInput["client"]


interface MessagePartInfo {
  id?: string
  sessionID?: string
  type?: string
  tool?: string
  state?: { status?: string; input?: Record<string, unknown> }
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

function resolveMessagePartInfo(properties: EventProperties | undefined): MessagePartInfo | undefined {
  if (!properties || typeof properties !== "object") {
    return undefined
  }

  const nestedPart = properties.part
  if (nestedPart && typeof nestedPart === "object") {
    return nestedPart as MessagePartInfo
  }

  return properties as MessagePartInfo
}

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

interface QueueItem {
  task: BackgroundTask
  input: LaunchInput
}

export interface SubagentSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>

const MAX_TASK_REMOVAL_RESCHEDULES = 6

export class BackgroundManager {


  private tasks: Map<string, BackgroundTask>
  private notifications: Map<string, BackgroundTask[]>
  private pendingNotifications: Map<string, string[]>
  private pendingByParent: Map<string, Set<string>>  // Track pending tasks per parent for batching
  private client: OpencodeClient
  private directory: string
  private pollingInterval?: ReturnType<typeof setInterval>
  private pollingInFlight = false
  private concurrencyManager: ConcurrencyManager
  private shutdownTriggered = false
  private config?: BackgroundTaskConfig
  private tmuxEnabled: boolean
  private onSubagentSessionCreated?: OnSubagentSessionCreated
  private onShutdown?: () => void | Promise<void>

  private queuesByKey: Map<string, QueueItem[]> = new Map()
  private processingKeys: Set<string> = new Set()
  private completionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private completedTaskSummaries: Map<string, Array<{id: string, description: string}>> = new Map()
  private idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private notificationQueueByParent: Map<string, Promise<void>> = new Map()
  private rootDescendantCounts: Map<string, number>
  private preStartDescendantReservations: Set<string>
  private enableParentSessionNotifications: boolean
  readonly taskHistory = new TaskHistory()
  private cachedCircuitBreakerSettings?: CircuitBreakerSettings

  constructor(
    ctx: PluginInput,
    config?: BackgroundTaskConfig,
    options?: {
      tmuxConfig?: TmuxConfig
      onSubagentSessionCreated?: OnSubagentSessionCreated
      onShutdown?: () => void | Promise<void>
      enableParentSessionNotifications?: boolean
    }
  ) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.pendingNotifications = new Map()
    this.pendingByParent = new Map()
    this.client = ctx.client
    this.directory = ctx.directory
    this.concurrencyManager = new ConcurrencyManager(config)
    this.config = config
    this.tmuxEnabled = options?.tmuxConfig?.enabled ?? false
    this.onSubagentSessionCreated = options?.onSubagentSessionCreated
    this.onShutdown = options?.onShutdown
    this.rootDescendantCounts = new Map()
    this.preStartDescendantReservations = new Set()
    this.enableParentSessionNotifications = options?.enableParentSessionNotifications ?? true
    this.registerProcessCleanup()
  }

  async assertCanSpawn(parentSessionID: string): Promise<SubagentSpawnContext> {
    const spawnContext = await resolveSubagentSpawnContext(this.client, parentSessionID)
    const maxDepth = getMaxSubagentDepth(this.config)
    if (spawnContext.childDepth > maxDepth) {
      throw createSubagentDepthLimitError({
        childDepth: spawnContext.childDepth,
        maxDepth,
        parentSessionID,
        rootSessionID: spawnContext.rootSessionID,
      })
    }

    const maxRootSessionSpawnBudget = getMaxRootSessionSpawnBudget(this.config)
    const descendantCount = this.rootDescendantCounts.get(spawnContext.rootSessionID) ?? 0
    if (descendantCount >= maxRootSessionSpawnBudget) {
      throw createSubagentDescendantLimitError({
        rootSessionID: spawnContext.rootSessionID,
        descendantCount,
        maxDescendants: maxRootSessionSpawnBudget,
      })
    }

    return spawnContext
  }

  async reserveSubagentSpawn(parentSessionID: string): Promise<{
    spawnContext: SubagentSpawnContext
    descendantCount: number
    commit: () => number
    rollback: () => void
  }> {
    const spawnContext = await this.assertCanSpawn(parentSessionID)
    const descendantCount = this.registerRootDescendant(spawnContext.rootSessionID)
    let settled = false

    return {
      spawnContext,
      descendantCount,
      commit: () => {
        settled = true
        return descendantCount
      },
      rollback: () => {
        if (settled) return
        settled = true
        this.unregisterRootDescendant(spawnContext.rootSessionID)
      },
    }
  }

  private registerRootDescendant(rootSessionID: string): number {
    const nextCount = (this.rootDescendantCounts.get(rootSessionID) ?? 0) + 1
    this.rootDescendantCounts.set(rootSessionID, nextCount)
    return nextCount
  }

  private unregisterRootDescendant(rootSessionID: string): void {
    const currentCount = this.rootDescendantCounts.get(rootSessionID) ?? 0
    if (currentCount <= 1) {
      this.rootDescendantCounts.delete(rootSessionID)
      return
    }

    this.rootDescendantCounts.set(rootSessionID, currentCount - 1)
  }

  private markPreStartDescendantReservation(task: BackgroundTask): void {
    this.preStartDescendantReservations.add(task.id)
  }

  private settlePreStartDescendantReservation(task: BackgroundTask): void {
    this.preStartDescendantReservations.delete(task.id)
  }

  private rollbackPreStartDescendantReservation(task: BackgroundTask): void {
    if (!this.preStartDescendantReservations.delete(task.id)) {
      return
    }

    if (!task.rootSessionID) {
      return
    }

    this.unregisterRootDescendant(task.rootSessionID)
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

    const spawnReservation = await this.reserveSubagentSpawn(input.parentSessionID)

    try {
      log("[background-agent] spawn guard passed", {
        parentSessionID: input.parentSessionID,
        rootSessionID: spawnReservation.spawnContext.rootSessionID,
        childDepth: spawnReservation.spawnContext.childDepth,
        descendantCount: spawnReservation.descendantCount,
      })

      // Create task immediately with status="pending"
      const task: BackgroundTask = {
        id: `bg_${crypto.randomUUID().slice(0, 8)}`,
        status: "pending",
        queuedAt: new Date(),
        rootSessionID: spawnReservation.spawnContext.rootSessionID,
        // Do NOT set startedAt - will be set when running
        // Do NOT set sessionID - will be set when running
        description: input.description,
        prompt: input.prompt,
        agent: input.agent,
        spawnDepth: spawnReservation.spawnContext.childDepth,
        parentSessionID: input.parentSessionID,
        parentMessageID: input.parentMessageID,
        parentModel: input.parentModel,
        parentAgent: input.parentAgent,
        parentTools: input.parentTools,
        model: input.model,
        fallbackChain: input.fallbackChain,
        attemptCount: 0,
        category: input.category,
      }

      this.tasks.set(task.id, task)
      this.taskHistory.record(input.parentSessionID, { id: task.id, agent: input.agent, description: input.description, status: "pending", category: input.category })

      // Track for batched notifications immediately (pending state)
      if (input.parentSessionID) {
        const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
        pending.add(task.id)
        this.pendingByParent.set(input.parentSessionID, pending)
      }

      // Add to queue
      const key = this.getConcurrencyKeyFromInput(input)
      const queue = this.queuesByKey.get(key) ?? []
      queue.push({ task, input })
      this.queuesByKey.set(key, queue)

      log("[background-agent] Task queued:", { taskId: task.id, key, queueLength: queue.length })

      const toastManager = getTaskToastManager()
      if (toastManager) {
        toastManager.addTask({
          id: task.id,
          description: input.description,
          agent: input.agent,
          isBackground: true,
          status: "queued",
          skills: input.skills,
        })
      }

      spawnReservation.commit()
      this.markPreStartDescendantReservation(task)

      // Trigger processing (fire-and-forget)
      this.processKey(key)

      return { ...task }
    } catch (error) {
      spawnReservation.rollback()
      throw error
    }
  }

  private async processKey(key: string): Promise<void> {
    if (this.processingKeys.has(key)) {
      return
    }

    this.processingKeys.add(key)

    try {
      const queue = this.queuesByKey.get(key)
      while (queue && queue.length > 0) {
        const item = queue.shift()
        if (!item) {
          continue
        }

        await this.concurrencyManager.acquire(key)

        if (item.task.status === "cancelled" || item.task.status === "error" || item.task.status === "interrupt") {
          this.rollbackPreStartDescendantReservation(item.task)
          this.concurrencyManager.release(key)
          continue
        }

        try {
          await this.startTask(item)
        } catch (error) {
          log("[background-agent] Error starting task:", error)
          this.rollbackPreStartDescendantReservation(item.task)
          if (item.task.concurrencyKey) {
            this.concurrencyManager.release(item.task.concurrencyKey)
            item.task.concurrencyKey = undefined
          } else {
            this.concurrencyManager.release(key)
          }
        }
      }
    } finally {
      this.processingKeys.delete(key)
    }
  }

  private async startTask(item: QueueItem): Promise<void> {
    const { task, input } = item

    log("[background-agent] Starting task:", {
      taskId: task.id,
      agent: input.agent,
      model: input.model,
    })

    const concurrencyKey = this.getConcurrencyKeyFromInput(input)

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
        title: `${input.description} (@${input.agent} subagent)`,
        ...(input.sessionPermission ? { permission: input.sessionPermission } : {}),
      } as Record<string, unknown>,
      query: {
        directory: parentDirectory,
      },
    })

    if (createResult.error) {
      throw new Error(`Failed to create background session: ${createResult.error}`)
    }

    if (!createResult.data?.id) {
      throw new Error("Failed to create background session: API returned no session ID")
    }

    const sessionID = createResult.data.id

    if (task.status === "cancelled") {
      await this.client.session.abort({
        path: { id: sessionID },
      }).catch((error) => {
        log("[background-agent] Failed to abort cancelled pre-start session:", error)
      })
      this.concurrencyManager.release(concurrencyKey)
      return
    }

    this.settlePreStartDescendantReservation(task)
    subagentSessions.add(sessionID)

    log("[background-agent] tmux callback check", {
      hasCallback: !!this.onSubagentSessionCreated,
      tmuxEnabled: this.tmuxEnabled,
      isInsideTmux: isInsideTmux(),
      sessionID,
      parentID: input.parentSessionID,
    })

    if (this.onSubagentSessionCreated && this.tmuxEnabled && isInsideTmux()) {
      log("[background-agent] Invoking tmux callback NOW", { sessionID })
      await this.onSubagentSessionCreated({
        sessionID,
        parentID: input.parentSessionID,
        title: input.description,
      }).catch((err) => {
        log("[background-agent] Failed to spawn tmux pane:", err)
      })
      log("[background-agent] tmux callback completed, waiting 200ms")
      await new Promise(r => setTimeout(r, 200))
    } else {
      log("[background-agent] SKIP tmux callback - conditions not met")
    }

    // Update task to running state
    task.status = "running"
    task.startedAt = new Date()
    task.sessionID = sessionID
    task.progress = {
      toolCalls: 0,
      lastUpdate: new Date(),
    }
    task.concurrencyKey = concurrencyKey
    task.concurrencyGroup = concurrencyKey

    this.taskHistory.record(input.parentSessionID, { id: task.id, sessionID, agent: input.agent, description: input.description, status: "running", category: input.category, startedAt: task.startedAt })
    this.startPolling()

    log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: input.agent })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.updateTask(task.id, "running")
    }

    log("[background-agent] Calling prompt (fire-and-forget) for launch with:", {
      sessionID,
      agent: input.agent,
      model: input.model,
      hasSkillContent: !!input.skillContent,
      promptLength: input.prompt.length,
    })

    // Fire-and-forget prompt via promptAsync (no response body needed)
    // OpenCode prompt payload accepts model provider/model IDs and top-level variant only.
    // Temperature/topP and provider-specific options are applied through chat.params.
    const launchModel = input.model
      ? {
          providerID: input.model.providerID,
          modelID: input.model.modelID,
        }
      : undefined
    const launchVariant = input.model?.variant

    if (input.model) {
      applySessionPromptParams(sessionID, input.model)
    }

    promptWithModelSuggestionRetry(this.client, {
      path: { id: sessionID },
      body: {
        agent: input.agent,
        ...(launchModel ? { model: launchModel } : {}),
        ...(launchVariant ? { variant: launchVariant } : {}),
        system: input.skillContent,
        tools: (() => {
          const tools = {
            task: false,
            call_omo_agent: true,
            question: false,
            ...getAgentToolRestrictions(input.agent),
          }
          setSessionTools(sessionID, tools)
          return tools
        })(),
        parts: [createInternalAgentTextPart(input.prompt)],
      },
    }).catch((error) => {
      log("[background-agent] promptAsync error:", error)
      const existingTask = this.findBySession(sessionID)
      if (existingTask) {
        existingTask.status = "interrupt"
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
          existingTask.error = `Agent "${input.agent}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`
        } else {
          existingTask.error = errorMessage
        }
        existingTask.completedAt = new Date()
        if (existingTask.rootSessionID) {
          this.unregisterRootDescendant(existingTask.rootSessionID)
        }
        if (existingTask.concurrencyKey) {
          this.concurrencyManager.release(existingTask.concurrencyKey)
          existingTask.concurrencyKey = undefined
        }

        removeTaskToastTracking(existingTask.id)

        // Abort the session to prevent infinite polling hang
        this.client.session.abort({
          path: { id: sessionID },
        }).catch(() => {})

        this.markForNotification(existingTask)
        this.enqueueNotificationForParent(existingTask.parentSessionID, () => this.notifyParentSession(existingTask)).catch(err => {
          log("[background-agent] Failed to notify on error:", err)
        })
      }
    })
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
      if (child.sessionID) {
        const descendants = this.getAllDescendantTasks(child.sessionID)
        result.push(...descendants)
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

  private getConcurrencyKeyFromInput(input: LaunchInput): string {
    if (input.model) {
      return `${input.model.providerID}/${input.model.modelID}`
    }
    return input.agent
  }

  /**
   * Track a task created elsewhere (e.g., from task) for notification tracking.
   * This allows tasks created by other tools to receive the same toast/prompt notifications.
   */
  async trackTask(input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }): Promise<BackgroundTask> {
    const existingTask = this.tasks.get(input.taskId)
    if (existingTask) {
      // P2 fix: Clean up old parent's pending set BEFORE changing parent
      // Otherwise cleanupPendingByParent would use the new parent ID
      const parentChanged = input.parentSessionID !== existingTask.parentSessionID
      if (parentChanged) {
        this.cleanupPendingByParent(existingTask)  // Clean from OLD parent
        existingTask.parentSessionID = input.parentSessionID
      }
      if (input.parentAgent !== undefined) {
        existingTask.parentAgent = input.parentAgent
      }
      if (!existingTask.concurrencyGroup) {
        existingTask.concurrencyGroup = input.concurrencyKey ?? existingTask.agent
      }

      if (existingTask.sessionID) {
        subagentSessions.add(existingTask.sessionID)
      }
      this.startPolling()

      // Track for batched notifications if task is pending or running
      if (existingTask.status === "pending" || existingTask.status === "running") {
        const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
        pending.add(existingTask.id)
        this.pendingByParent.set(input.parentSessionID, pending)
      } else if (!parentChanged) {
        // Only clean up if parent didn't change (already cleaned above if it did)
        this.cleanupPendingByParent(existingTask)
      }

      log("[background-agent] External task already registered:", { taskId: existingTask.id, sessionID: existingTask.sessionID, status: existingTask.status })

      return existingTask
    }

    const concurrencyGroup = input.concurrencyKey ?? input.agent ?? "task"

    // Acquire concurrency slot if a key is provided
    if (input.concurrencyKey) {
      await this.concurrencyManager.acquire(input.concurrencyKey)
    }

    const task: BackgroundTask = {
      id: input.taskId,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: "",
      description: input.description,
      prompt: "",
      agent: input.agent || "task",
      status: "running",
      startedAt: new Date(),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
      parentAgent: input.parentAgent,
      concurrencyKey: input.concurrencyKey,
      concurrencyGroup,
    }

    this.tasks.set(task.id, task)
    subagentSessions.add(input.sessionID)
    this.startPolling()
    this.taskHistory.record(input.parentSessionID, { id: task.id, sessionID: input.sessionID, agent: input.agent || "task", description: input.description, status: "running", startedAt: task.startedAt })

    if (input.parentSessionID) {
      const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
      pending.add(task.id)
      this.pendingByParent.set(input.parentSessionID, pending)
    }

    log("[background-agent] Registered external task:", { taskId: task.id, sessionID: input.sessionID })

    return task
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    if (!existingTask.sessionID) {
      throw new Error(`Task has no sessionID: ${existingTask.id}`)
    }

    if (existingTask.status === "running") {
      log("[background-agent] Resume skipped - task already running:", {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
      })
      return existingTask
    }

    const completionTimer = this.completionTimers.get(existingTask.id)
    if (completionTimer) {
      clearTimeout(completionTimer)
      this.completionTimers.delete(existingTask.id)
    }

    // Re-acquire concurrency using the persisted concurrency group
    const concurrencyKey = existingTask.concurrencyGroup ?? existingTask.agent
    await this.concurrencyManager.acquire(concurrencyKey)
    existingTask.concurrencyKey = concurrencyKey
    existingTask.concurrencyGroup = concurrencyKey


    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel
    existingTask.parentAgent = input.parentAgent
    if (input.parentTools) {
      existingTask.parentTools = input.parentTools
    }
    // Reset startedAt on resume to prevent immediate completion
    // The MIN_IDLE_TIME_MS check uses startedAt, so resumed tasks need fresh timing
    existingTask.startedAt = new Date()

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      toolCallWindow: existingTask.progress?.toolCallWindow,
      countedToolPartIDs: existingTask.progress?.countedToolPartIDs,
      lastUpdate: new Date(),
    }

    this.startPolling()
    if (existingTask.sessionID) {
      subagentSessions.add(existingTask.sessionID)
    }

    if (input.parentSessionID) {
      const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
      pending.add(existingTask.id)
      this.pendingByParent.set(input.parentSessionID, pending)
    }

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
      model: existingTask.model,
      promptLength: input.prompt.length,
    })

    // Fire-and-forget prompt via promptAsync (no response body needed)
    // Resume uses the same PromptInput contract as launch: model IDs plus top-level variant.
    const resumeModel = existingTask.model
      ? {
          providerID: existingTask.model.providerID,
          modelID: existingTask.model.modelID,
        }
      : undefined
    const resumeVariant = existingTask.model?.variant

    if (existingTask.model) {
      applySessionPromptParams(existingTask.sessionID!, existingTask.model)
    }

    this.client.session.promptAsync({
      path: { id: existingTask.sessionID },
      body: {
        agent: existingTask.agent,
        ...(resumeModel ? { model: resumeModel } : {}),
        ...(resumeVariant ? { variant: resumeVariant } : {}),
        tools: (() => {
          const tools = {
            task: false,
            call_omo_agent: true,
            question: false,
            ...getAgentToolRestrictions(existingTask.agent),
          }
          setSessionTools(existingTask.sessionID!, tools)
          return tools
        })(),
        parts: [createInternalAgentTextPart(input.prompt)],
      },
    }).catch((error) => {
      log("[background-agent] resume prompt error:", error)
      existingTask.status = "interrupt"
      const errorMessage = error instanceof Error ? error.message : String(error)
      existingTask.error = errorMessage
      existingTask.completedAt = new Date()
      if (existingTask.rootSessionID) {
        this.unregisterRootDescendant(existingTask.rootSessionID)
      }

      // Release concurrency on error to prevent slot leaks
      if (existingTask.concurrencyKey) {
        this.concurrencyManager.release(existingTask.concurrencyKey)
        existingTask.concurrencyKey = undefined
      }

      removeTaskToastTracking(existingTask.id)

      // Abort the session to prevent infinite polling hang
      if (existingTask.sessionID) {
        this.client.session.abort({
          path: { id: existingTask.sessionID },
        }).catch(() => {})
      }

      this.markForNotification(existingTask)
      this.enqueueNotificationForParent(existingTask.parentSessionID, () => this.notifyParentSession(existingTask)).catch(err => {
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
      const todos = normalizeSDKResponse(response, [] as Todo[], { preferResponseOnMissingData: true })
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

    if (event.type === "message.updated") {
      const info = props?.info
      if (!info || typeof info !== "object") return

      const sessionID = (info as Record<string, unknown>)["sessionID"]
      const role = (info as Record<string, unknown>)["role"]
      if (typeof sessionID !== "string" || role !== "assistant") return

      const task = this.findBySession(sessionID)
      if (!task || task.status !== "running") return

      const assistantError = (info as Record<string, unknown>)["error"]
      if (!assistantError) return

      const errorInfo = {
        name: extractErrorName(assistantError),
        message: extractErrorMessage(assistantError),
      }
      this.tryFallbackRetry(task, errorInfo, "message.updated")
    }

    if (event.type === "message.part.updated" || event.type === "message.part.delta") {
      const partInfo = resolveMessagePartInfo(props)
      const sessionID = partInfo?.sessionID
      if (!sessionID) return

      const task = this.findBySession(sessionID)
      if (!task) return

      // Clear any pending idle deferral timer since the task is still active
      const existingTimer = this.idleDeferralTimers.get(task.id)
      if (existingTimer) {
        clearTimeout(existingTimer)
        this.idleDeferralTimers.delete(task.id)
      }

      if (!task.progress) {
        task.progress = {
          toolCalls: 0,
          lastUpdate: new Date(),
        }
      }
      task.progress.lastUpdate = new Date()

      if (partInfo?.type === "tool" || partInfo?.tool) {
        const countedToolPartIDs = task.progress.countedToolPartIDs ?? new Set<string>()
        const shouldCountToolCall =
          !partInfo.id ||
          partInfo.state?.status !== "running" ||
          !countedToolPartIDs.has(partInfo.id)

        if (!shouldCountToolCall) {
          return
        }

        if (partInfo.id && partInfo.state?.status === "running") {
          countedToolPartIDs.add(partInfo.id)
          task.progress.countedToolPartIDs = countedToolPartIDs
        }

        task.progress.toolCalls += 1
        task.progress.lastTool = partInfo.tool
        const circuitBreaker = this.cachedCircuitBreakerSettings ?? (this.cachedCircuitBreakerSettings = resolveCircuitBreakerSettings(this.config))
        if (partInfo.tool) {
         task.progress.toolCallWindow = recordToolCall(
             task.progress.toolCallWindow,
             partInfo.tool,
             circuitBreaker,
             partInfo.state?.input
           )

           if (circuitBreaker.enabled) {
             const loopDetection = detectRepetitiveToolUse(task.progress.toolCallWindow)
             if (loopDetection.triggered) {
               log("[background-agent] Circuit breaker: consecutive tool usage detected", {
                 taskId: task.id,
                 agent: task.agent,
                 sessionID,
                 toolName: loopDetection.toolName,
                 repeatedCount: loopDetection.repeatedCount,
               })
               void this.cancelTask(task.id, {
                 source: "circuit-breaker",
                 reason: `Subagent called ${loopDetection.toolName} ${loopDetection.repeatedCount} consecutive times (threshold: ${circuitBreaker.consecutiveThreshold}). This usually indicates an infinite loop. The task was automatically cancelled to prevent excessive token usage.`,
               })
               return
             }
           }
        }

        const maxToolCalls = circuitBreaker.maxToolCalls
        if (task.progress.toolCalls >= maxToolCalls) {
          log("[background-agent] Circuit breaker: tool call limit reached", {
            taskId: task.id,
            toolCalls: task.progress.toolCalls,
            maxToolCalls,
            agent: task.agent,
            sessionID,
          })
          void this.cancelTask(task.id, {
            source: "circuit-breaker",
            reason: `Subagent exceeded maximum tool call limit (${maxToolCalls}). This usually indicates an infinite loop. The task was automatically cancelled to prevent excessive token usage.`,
          })
        }
      }
    }

    if (event.type === "session.idle") {
      if (!props || typeof props !== "object") return
      handleSessionIdleBackgroundEvent({
        properties: props as Record<string, unknown>,
        findBySession: (id) => this.findBySession(id),
        idleDeferralTimers: this.idleDeferralTimers,
        validateSessionHasOutput: (id) => this.validateSessionHasOutput(id),
        checkSessionTodos: (id) => this.checkSessionTodos(id),
        tryCompleteTask: (task, source) => this.tryCompleteTask(task, source),
        emitIdleEvent: (sessionID) => this.handleEvent({ type: "session.idle", properties: { sessionID } }),
      })
    }

    if (event.type === "session.error") {
      const sessionID = typeof props?.sessionID === "string" ? props.sessionID : undefined
      if (!sessionID) return

      const task = this.findBySession(sessionID)
      if (!task || task.status !== "running") return

      const errorObj = props?.error as { name?: string; message?: string } | undefined
      const errorName = errorObj?.name
      const errorMessage = props ? getSessionErrorMessage(props) : undefined

      const errorInfo = { name: errorName, message: errorMessage }
      if (this.tryFallbackRetry(task, errorInfo, "session.error")) return

      // Original error handling (no retry)
      const errorMsg = errorMessage ?? "Session error"
      const canRetry =
        shouldRetryError(errorInfo) &&
        !!task.fallbackChain &&
        hasMoreFallbacks(task.fallbackChain, task.attemptCount ?? 0)
      log("[background-agent] Session error - no retry:", {
        taskId: task.id,
        errorName,
        errorMessage: errorMsg?.slice(0, 100),
        hasFallbackChain: !!task.fallbackChain,
        canRetry,
      })

      task.status = "error"
      task.error = errorMsg
      task.completedAt = new Date()
      if (task.rootSessionID) {
        this.unregisterRootDescendant(task.rootSessionID)
      }
      this.taskHistory.record(task.parentSessionID, { id: task.id, sessionID: task.sessionID, agent: task.agent, description: task.description, status: "error", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }

      const completionTimer = this.completionTimers.get(task.id)
      if (completionTimer) {
        clearTimeout(completionTimer)
        this.completionTimers.delete(task.id)
      }

      const idleTimer = this.idleDeferralTimers.get(task.id)
      if (idleTimer) {
        clearTimeout(idleTimer)
        this.idleDeferralTimers.delete(task.id)
      }

      this.cleanupPendingByParent(task)
      this.clearNotificationsForTask(task.id)
      const toastManager = getTaskToastManager()
      if (toastManager) {
        toastManager.removeTask(task.id)
      }
      this.scheduleTaskRemoval(task.id)
      if (task.sessionID) {
        SessionCategoryRegistry.remove(task.sessionID)
      }

      this.markForNotification(task)
      this.enqueueNotificationForParent(task.parentSessionID, () => this.notifyParentSession(task)).catch(err => {
        log("[background-agent] Error in notifyParentSession for errored task:", { taskId: task.id, error: err })
      })
    }

    if (event.type === "session.deleted") {
      const info = props?.info
      if (!info || typeof info.id !== "string") return
      const sessionID = info.id

      const tasksToCancel = new Map<string, BackgroundTask>()
      const directTask = this.findBySession(sessionID)
      if (directTask) {
        tasksToCancel.set(directTask.id, directTask)
      }
      for (const descendant of this.getAllDescendantTasks(sessionID)) {
        tasksToCancel.set(descendant.id, descendant)
      }

      this.pendingNotifications.delete(sessionID)

      if (tasksToCancel.size === 0) {
        this.clearTaskHistoryWhenParentTasksGone(sessionID)
        return
      }

      const parentSessionsToClear = new Set<string>()

      const deletedSessionIDs = new Set<string>([sessionID])
      for (const task of tasksToCancel.values()) {
        if (task.sessionID) {
          deletedSessionIDs.add(task.sessionID)
        }
      }

      for (const task of tasksToCancel.values()) {
        parentSessionsToClear.add(task.parentSessionID)

        if (task.status === "running" || task.status === "pending") {
          void this.cancelTask(task.id, {
            source: "session.deleted",
            reason: "Session deleted",
          }).then(() => {
            if (deletedSessionIDs.has(task.parentSessionID)) {
              this.pendingNotifications.delete(task.parentSessionID)
            }
          }).catch(err => {
            if (deletedSessionIDs.has(task.parentSessionID)) {
              this.pendingNotifications.delete(task.parentSessionID)
            }
            log("[background-agent] Failed to cancel task on session.deleted:", { taskId: task.id, error: err })
          })
        }
      }

      for (const parentSessionID of parentSessionsToClear) {
        this.clearTaskHistoryWhenParentTasksGone(parentSessionID)
      }

      this.rootDescendantCounts.delete(sessionID)
      SessionCategoryRegistry.remove(sessionID)
    }

    if (event.type === "session.status") {
      const sessionID = props?.sessionID as string | undefined
      const status = props?.status as { type?: string; message?: string } | undefined
      if (!sessionID || status?.type !== "retry") return

      const task = this.findBySession(sessionID)
      if (!task || task.status !== "running") return

      const errorMessage = typeof status.message === "string" ? status.message : undefined
      const errorInfo = { name: "SessionRetry", message: errorMessage }
      this.tryFallbackRetry(task, errorInfo, "session.status")
    }
  }

  private tryFallbackRetry(
    task: BackgroundTask,
    errorInfo: { name?: string; message?: string },
    source: string,
  ): boolean {
    const previousSessionID = task.sessionID
    const result = tryFallbackRetry({
      task,
      errorInfo,
      source,
      concurrencyManager: this.concurrencyManager,
      client: this.client,
      idleDeferralTimers: this.idleDeferralTimers,
      queuesByKey: this.queuesByKey,
      processKey: (key: string) => this.processKey(key),
    })
    if (result && previousSessionID) {
      subagentSessions.delete(previousSessionID)
    }
    return result
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

  queuePendingNotification(sessionID: string | undefined, notification: string): void {
    if (!sessionID) return
    const existingNotifications = this.pendingNotifications.get(sessionID) ?? []
    existingNotifications.push(notification)
    this.pendingNotifications.set(sessionID, existingNotifications)
  }

  injectPendingNotificationsIntoChatMessage(output: { parts: Array<{ type: string; text?: string; [key: string]: unknown }> }, sessionID: string): void {
    const pendingNotifications = this.pendingNotifications.get(sessionID)
    if (!pendingNotifications || pendingNotifications.length === 0) {
      return
    }

    this.pendingNotifications.delete(sessionID)
    const notificationContent = pendingNotifications.join("\n\n")
    const firstTextPartIndex = output.parts.findIndex((part) => part.type === "text")

    if (firstTextPartIndex === -1) {
      output.parts.unshift(createInternalAgentTextPart(notificationContent))
      return
    }

    const originalText = output.parts[firstTextPartIndex].text ?? ""
    output.parts[firstTextPartIndex].text = `${notificationContent}\n\n---\n\n${originalText}`
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

      const messages = normalizeSDKResponse(response, [] as Array<{ info?: { role?: string } }>, { preferResponseOnMissingData: true })
      
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

  /**
   * Remove task from pending tracking for its parent session.
   * Cleans up the parent entry if no pending tasks remain.
   */
  private cleanupPendingByParent(task: BackgroundTask): void {
    if (!task.parentSessionID) return
    const pending = this.pendingByParent.get(task.parentSessionID)
    if (pending) {
      pending.delete(task.id)
      if (pending.size === 0) {
        this.pendingByParent.delete(task.parentSessionID)
      }
    }
  }

  private clearTaskHistoryWhenParentTasksGone(parentSessionID: string | undefined): void {
    if (!parentSessionID) return
    if (this.getTasksByParentSession(parentSessionID).length > 0) return
    this.taskHistory.clearSession(parentSessionID)
    this.completedTaskSummaries.delete(parentSessionID)
  }

  private scheduleTaskRemoval(taskId: string, rescheduleCount = 0): void {
    const existingTimer = this.completionTimers.get(taskId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.completionTimers.delete(taskId)
    }

    const timer = setTimeout(() => {
      this.completionTimers.delete(taskId)
      const task = this.tasks.get(taskId)
      if (!task) return

      if (task.parentSessionID) {
        const siblings = this.getTasksByParentSession(task.parentSessionID)
        const runningOrPendingSiblings = siblings.filter(
          sibling => sibling.id !== taskId && (sibling.status === "running" || sibling.status === "pending"),
        )
        const completedAtTimestamp = task.completedAt?.getTime()
        const reachedTaskTtl = completedAtTimestamp !== undefined && (Date.now() - completedAtTimestamp) >= TASK_TTL_MS
        if (runningOrPendingSiblings.length > 0 && rescheduleCount < MAX_TASK_REMOVAL_RESCHEDULES && !reachedTaskTtl) {
          this.scheduleTaskRemoval(taskId, rescheduleCount + 1)
          return
        }
      }

      this.clearNotificationsForTask(taskId)
      this.tasks.delete(taskId)
      this.clearTaskHistoryWhenParentTasksGone(task.parentSessionID)
      if (task.sessionID) {
        subagentSessions.delete(task.sessionID)
        SessionCategoryRegistry.remove(task.sessionID)
      }
      log("[background-agent] Removed completed task from memory:", taskId)
    }, TASK_CLEANUP_DELAY_MS)

    this.completionTimers.set(taskId, timer)
  }

  async cancelTask(
    taskId: string,
    options?: { source?: string; reason?: string; abortSession?: boolean; skipNotification?: boolean }
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || (task.status !== "running" && task.status !== "pending")) {
      return false
    }

    const source = options?.source ?? "cancel"
    const abortSession = options?.abortSession !== false
    const reason = options?.reason

    if (task.status === "pending") {
      const key = task.model
        ? `${task.model.providerID}/${task.model.modelID}`
        : task.agent
      const queue = this.queuesByKey.get(key)
      if (queue) {
        const index = queue.findIndex(item => item.task.id === taskId)
        if (index !== -1) {
          queue.splice(index, 1)
          if (queue.length === 0) {
            this.queuesByKey.delete(key)
          }
        }
      }
      this.rollbackPreStartDescendantReservation(task)
      log("[background-agent] Cancelled pending task:", { taskId, key })
    }

    const wasRunning = task.status === "running"
    task.status = "cancelled"
    task.completedAt = new Date()
    if (wasRunning && task.rootSessionID) {
      this.unregisterRootDescendant(task.rootSessionID)
    }
    if (reason) {
      task.error = reason
    }
    this.taskHistory.record(task.parentSessionID, { id: task.id, sessionID: task.sessionID, agent: task.agent, description: task.description, status: "cancelled", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })

    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    const existingTimer = this.completionTimers.get(task.id)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.completionTimers.delete(task.id)
    }

    const idleTimer = this.idleDeferralTimers.get(task.id)
    if (idleTimer) {
      clearTimeout(idleTimer)
      this.idleDeferralTimers.delete(task.id)
    }

    if (abortSession && task.sessionID) {
      this.client.session.abort({
        path: { id: task.sessionID },
      }).catch(() => {})

      SessionCategoryRegistry.remove(task.sessionID)
    }

    removeTaskToastTracking(task.id)

    if (options?.skipNotification) {
      this.cleanupPendingByParent(task)
      this.scheduleTaskRemoval(task.id)
      log(`[background-agent] Task cancelled via ${source} (notification skipped):`, task.id)
      return true
    }

    this.markForNotification(task)

    try {
      await this.enqueueNotificationForParent(task.parentSessionID, () => this.notifyParentSession(task))
      log(`[background-agent] Task cancelled via ${source}:`, task.id)
    } catch (err) {
      log("[background-agent] Error in notifyParentSession for cancelled task:", { taskId: task.id, error: err })
    }

    return true
  }

  /**
   * Cancels a pending task by removing it from queue and marking as cancelled.
   * Does NOT abort session (no session exists yet) or release concurrency slot (wasn't acquired).
   */
  cancelPendingTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "pending") {
      return false
    }

    void this.cancelTask(taskId, { source: "cancelPendingTask", abortSession: false })
    return true
  }

  private startPolling(): void {
    if (this.pollingInterval) return

    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks()
    }, POLLING_INTERVAL_MS)
    this.pollingInterval.unref()
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = undefined
    }
  }

  private registerProcessCleanup(): void {
    registerManagerForCleanup(this)
  }

  private unregisterProcessCleanup(): void {
    unregisterManagerForCleanup(this)
  }


  /**
   * Get all running tasks (for compaction hook)
   */
  getRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === "running")
  }

  /**
   * Get all non-running tasks still in memory (for compaction hook)
   */
  getNonRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status !== "running")
  }

  /**
   * Safely complete a task with race condition protection.
   * Returns true if task was successfully completed, false if already completed by another path.
   */
  private async tryCompleteTask(task: BackgroundTask, source: string): Promise<boolean> {
    // Guard: Check if task is still running (could have been completed by another path)
    if (task.status !== "running") {
      log("[background-agent] Task already completed, skipping:", { taskId: task.id, status: task.status, source })
      return false
    }

    // Atomically mark as completed to prevent race conditions
    task.status = "completed"
    task.completedAt = new Date()
    this.taskHistory.record(task.parentSessionID, { id: task.id, sessionID: task.sessionID, agent: task.agent, description: task.description, status: "completed", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })

    if (task.rootSessionID) {
      this.unregisterRootDescendant(task.rootSessionID)
    }

    removeTaskToastTracking(task.id)

    // Release concurrency BEFORE any async operations to prevent slot leaks
    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    this.markForNotification(task)

    const idleTimer = this.idleDeferralTimers.get(task.id)
    if (idleTimer) {
      clearTimeout(idleTimer)
      this.idleDeferralTimers.delete(task.id)
    }

    if (task.sessionID) {
      this.client.session.abort({
        path: { id: task.sessionID },
      }).catch(() => {})

      SessionCategoryRegistry.remove(task.sessionID)
    }

    try {
      await this.enqueueNotificationForParent(task.parentSessionID, () => this.notifyParentSession(task))
      log(`[background-agent] Task completed via ${source}:`, task.id)
    } catch (err) {
      log("[background-agent] Error in notifyParentSession:", { taskId: task.id, error: err })
      // Concurrency already released, notification failed but task is complete
    }

    return true
  }

  private async notifyParentSession(task: BackgroundTask): Promise<void> {
    // Note: Callers must release concurrency before calling this method
    // to ensure slots are freed even if notification fails

    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

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

    if (!this.completedTaskSummaries.has(task.parentSessionID)) {
      this.completedTaskSummaries.set(task.parentSessionID, [])
    }
    this.completedTaskSummaries.get(task.parentSessionID)!.push({
      id: task.id,
      description: task.description,
    })

    // Update pending tracking and check if all tasks complete
    const pendingSet = this.pendingByParent.get(task.parentSessionID)
    let allComplete = false
    let remainingCount = 0
    if (pendingSet) {
      pendingSet.delete(task.id)
      remainingCount = pendingSet.size
      allComplete = remainingCount === 0
      if (allComplete) {
        this.pendingByParent.delete(task.parentSessionID)
      }
    } else {
      remainingCount = Array.from(this.tasks.values())
        .filter(t => t.parentSessionID === task.parentSessionID && t.id !== task.id && (t.status === "running" || t.status === "pending"))
        .length
      allComplete = remainingCount === 0
    }

    const completedTasks = allComplete
      ? (this.completedTaskSummaries.get(task.parentSessionID) ?? [{ id: task.id, description: task.description }])
      : []

    if (allComplete) {
      this.completedTaskSummaries.delete(task.parentSessionID)
    }

    const statusText = task.status === "completed"
      ? "COMPLETED"
      : task.status === "interrupt"
        ? "INTERRUPTED"
        : task.status === "error"
          ? "ERROR"
          : "CANCELLED"
    const errorInfo = task.error ? `\n**Error:** ${task.error}` : ""

    let notification: string
    if (allComplete) {
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

      let agent: string | undefined = task.parentAgent
      let model: { providerID: string; modelID: string } | undefined
      let tools: Record<string, boolean> | undefined = task.parentTools

      if (this.enableParentSessionNotifications) {
        try {
          const messagesResp = await this.client.session.messages({ path: { id: task.parentSessionID } })
          const messages = normalizeSDKResponse(messagesResp, [] as Array<{
            info?: {
              agent?: string
              model?: { providerID: string; modelID: string }
              modelID?: string
              providerID?: string
              tools?: Record<string, boolean | "allow" | "deny" | "ask">
            }
          }>)
          const promptContext = resolvePromptContextFromSessionMessages(
            messages,
            task.parentSessionID,
          )
          const normalizedTools = isRecord(promptContext?.tools)
            ? normalizePromptTools(promptContext.tools)
            : undefined

          if (promptContext?.agent || promptContext?.model || normalizedTools) {
            agent = promptContext?.agent ?? task.parentAgent
            model = promptContext?.model?.providerID && promptContext.model.modelID
              ? { providerID: promptContext.model.providerID, modelID: promptContext.model.modelID }
              : undefined
            tools = normalizedTools ?? tools
          }
        } catch (error) {
          if (isAbortedSessionError(error)) {
            log("[background-agent] Parent session aborted while loading messages; using messageDir fallback:", {
              taskId: task.id,
              parentSessionID: task.parentSessionID,
            })
          }
          const messageDir = join(MESSAGE_STORAGE, task.parentSessionID)
          const currentMessage = messageDir
            ? findNearestMessageExcludingCompaction(messageDir, task.parentSessionID)
            : null
          agent = currentMessage?.agent ?? task.parentAgent
          model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
            ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
            : undefined
          tools = normalizePromptTools(currentMessage?.tools) ?? tools
        }

        const resolvedTools = resolveInheritedPromptTools(task.parentSessionID, tools)

        log("[background-agent] notifyParentSession context:", {
          taskId: task.id,
          resolvedAgent: agent,
          resolvedModel: model,
        })

        try {
          await this.client.session.promptAsync({
            path: { id: task.parentSessionID },
            body: {
              noReply: !allComplete,
              ...(agent !== undefined ? { agent } : {}),
              ...(model !== undefined ? { model } : {}),
              ...(resolvedTools ? { tools: resolvedTools } : {}),
              parts: [createInternalAgentTextPart(notification)],
            },
          })
          log("[background-agent] Sent notification to parent session:", {
            taskId: task.id,
            allComplete,
            noReply: !allComplete,
          })
        } catch (error) {
          if (isAbortedSessionError(error)) {
            log("[background-agent] Parent session aborted while sending notification; continuing cleanup:", {
              taskId: task.id,
              parentSessionID: task.parentSessionID,
            })
            this.queuePendingNotification(task.parentSessionID, notification)
          } else {
            log("[background-agent] Failed to send notification:", error)
          }
        }
      } else {
        log("[background-agent] Parent session notifications disabled, skipping prompt injection:", {
          taskId: task.id,
          parentSessionID: task.parentSessionID,
        })
      }

    if (task.status !== "running" && task.status !== "pending") {
      this.scheduleTaskRemoval(task.id)
    }
  }

  private hasRunningTasks(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === "running") return true
    }
    return false
  }

  private pruneStaleTasksAndNotifications(): void {
    pruneStaleTasksAndNotifications({
      tasks: this.tasks,
      notifications: this.notifications,
      onTaskPruned: (taskId, task, errorMessage) => {
        const wasPending = task.status === "pending"
        log("[background-agent] Pruning stale task:", { taskId, status: task.status, age: Math.round(((wasPending ? task.queuedAt?.getTime() : task.startedAt?.getTime()) ? (Date.now() - (wasPending ? task.queuedAt!.getTime() : task.startedAt!.getTime())) : 0) / 1000) + "s" })
        task.status = "error"
        task.error = errorMessage
        task.completedAt = new Date()
        if (!wasPending && task.rootSessionID) {
          this.unregisterRootDescendant(task.rootSessionID)
        }
        this.taskHistory.record(task.parentSessionID, { id: task.id, sessionID: task.sessionID, agent: task.agent, description: task.description, status: "error", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })
        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey)
          task.concurrencyKey = undefined
        }
        removeTaskToastTracking(task.id)
        const existingTimer = this.completionTimers.get(taskId)
        if (existingTimer) {
          clearTimeout(existingTimer)
          this.completionTimers.delete(taskId)
        }
        const idleTimer = this.idleDeferralTimers.get(taskId)
        if (idleTimer) {
          clearTimeout(idleTimer)
          this.idleDeferralTimers.delete(taskId)
        }
        if (wasPending) {
          const key = task.model
            ? `${task.model.providerID}/${task.model.modelID}`
            : task.agent
          const queue = this.queuesByKey.get(key)
          if (queue) {
            const index = queue.findIndex((item) => item.task.id === taskId)
            if (index !== -1) {
              queue.splice(index, 1)
              if (queue.length === 0) {
                this.queuesByKey.delete(key)
              }
            }
          }
        }
        this.cleanupPendingByParent(task)
        this.markForNotification(task)
        this.enqueueNotificationForParent(task.parentSessionID, () => this.notifyParentSession(task)).catch(err => {
          log("[background-agent] Error in notifyParentSession for stale-pruned task:", { taskId: task.id, error: err })
        })
      },
    })
  }

  private async checkAndInterruptStaleTasks(
    allStatuses: Record<string, { type: string }> = {},
  ): Promise<void> {
    await checkAndInterruptStaleTasks({
      tasks: this.tasks.values(),
      client: this.client,
      config: this.config,
      concurrencyManager: this.concurrencyManager,
      notifyParentSession: (task) => this.enqueueNotificationForParent(task.parentSessionID, () => this.notifyParentSession(task)),
      sessionStatuses: allStatuses,
    })
  }

  private async pollRunningTasks(): Promise<void> {
    if (this.pollingInFlight) return
    this.pollingInFlight = true
    try {
    this.pruneStaleTasksAndNotifications()

    const statusResult = await this.client.session.status()
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)

    await this.checkAndInterruptStaleTasks(allStatuses)

    for (const task of this.tasks.values()) {
      if (task.status !== "running") continue
      
      const sessionID = task.sessionID
      if (!sessionID) continue

      try {
        const sessionStatus = allStatuses[sessionID]
        // Handle retry before checking running state
        if (sessionStatus?.type === "retry") {
          const retryMessage = typeof (sessionStatus as { message?: string }).message === "string"
            ? (sessionStatus as { message?: string }).message
            : undefined
          const errorInfo = { name: "SessionRetry", message: retryMessage }
          if (this.tryFallbackRetry(task, errorInfo, "polling:session.status")) {
            continue
          }
        }

        // Only skip completion when session status is actively running.
        // Unknown or terminal statuses (like "interrupted") fall through to completion.
        if (sessionStatus && isActiveSessionStatus(sessionStatus.type)) {
          log("[background-agent] Session still running, relying on event-based progress:", {
            taskId: task.id,
            sessionID,
            sessionStatus: sessionStatus.type,
            toolCalls: task.progress?.toolCalls ?? 0,
          })
          continue
        }

        // Explicit terminal non-idle status (e.g., "interrupted") — complete immediately,
        // skipping output validation (session will never produce more output).
        // Unknown statuses fall through to the idle/gone path with output validation.
        if (sessionStatus && isTerminalSessionStatus(sessionStatus.type)) {
          await this.tryCompleteTask(task, `polling (terminal session status: ${sessionStatus.type})`)
          continue
        }

        // Unknown non-idle status — not active, not terminal, not idle.
        // Fall through to idle/gone completion path with output validation.
        if (sessionStatus && sessionStatus.type !== "idle") {
          log("[background-agent] Unknown session status, treating as potentially idle:", {
            taskId: task.id,
            sessionID,
            sessionStatus: sessionStatus.type,
          })
        }

        // Session is idle or no longer in status response (completed/disappeared)
        const completionSource = sessionStatus?.type === "idle"
          ? "polling (idle status)"
          : "polling (session gone from status)"
        const hasValidOutput = await this.validateSessionHasOutput(sessionID)
        if (!hasValidOutput) {
          log("[background-agent] Polling idle/gone but no valid output yet, waiting:", task.id)
          continue
        }

        // Re-check status after async operation
        if (task.status !== "running") continue

        const hasIncompleteTodos = await this.checkSessionTodos(sessionID)
        if (hasIncompleteTodos) {
          log("[background-agent] Task has incomplete todos via polling, waiting:", task.id)
          continue
        }

        await this.tryCompleteTask(task, completionSource)
      } catch (error) {
        log("[background-agent] Poll error for task:", { taskId: task.id, error })
      }
    }

    if (!this.hasRunningTasks()) {
      this.stopPolling()
    }
    } finally {
      this.pollingInFlight = false
    }
  }

  /**
   * Shutdown the manager gracefully.
   * Cancels all pending concurrency waiters and clears timers.
   * Should be called when the plugin is unloaded.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownTriggered) return
    this.shutdownTriggered = true
    log("[background-agent] Shutting down BackgroundManager")
    this.stopPolling()
    const trackedSessionIDs = new Set<string>()

    // Abort all running sessions to prevent zombie processes (#1240)
    for (const task of this.tasks.values()) {
      if (task.sessionID) {
        trackedSessionIDs.add(task.sessionID)
      }

      if (task.status === "running" && task.sessionID) {
        this.client.session.abort({
          path: { id: task.sessionID },
        }).catch(() => {})
      }
    }

    // Notify shutdown listeners (e.g., tmux cleanup)
    if (this.onShutdown) {
      try {
        await this.onShutdown()
      } catch (error) {
        log("[background-agent] Error in onShutdown callback:", error)
      }
    }

    // Release concurrency for all running tasks
    for (const task of this.tasks.values()) {
      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }
    }

    for (const timer of this.completionTimers.values()) {
      clearTimeout(timer)
    }
    this.completionTimers.clear()

    for (const timer of this.idleDeferralTimers.values()) {
      clearTimeout(timer)
    }
    this.idleDeferralTimers.clear()

    for (const sessionID of trackedSessionIDs) {
      subagentSessions.delete(sessionID)
      SessionCategoryRegistry.remove(sessionID)
    }

    this.concurrencyManager.clear()
    this.tasks.clear()
    this.notifications.clear()
    this.pendingNotifications.clear()
    this.pendingByParent.clear()
    this.notificationQueueByParent.clear()
    this.rootDescendantCounts.clear()
    this.queuesByKey.clear()
    this.processingKeys.clear()
    this.taskHistory.clearAll()
    this.completedTaskSummaries.clear()
    this.unregisterProcessCleanup()
    log("[background-agent] Shutdown complete")

  }

  private enqueueNotificationForParent(
    parentSessionID: string | undefined,
    operation: () => Promise<void>
  ): Promise<void> {
    if (!parentSessionID) {
      return operation()
    }

    const previous = this.notificationQueueByParent.get(parentSessionID) ?? Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(operation)

    this.notificationQueueByParent.set(parentSessionID, current)

    void current.finally(() => {
      if (this.notificationQueueByParent.get(parentSessionID) === current) {
        this.notificationQueueByParent.delete(parentSessionID)
      }
    }).catch(() => {})

    return current
  }
}
