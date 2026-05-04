
import type { PluginInput } from "@opencode-ai/plugin"
import type { ModelFallbackControllerAccessor } from "../../hooks/model-fallback"
import { isAgentNotFoundError, FALLBACK_AGENT, buildFallbackBody } from "./spawner"
import type {
  BackgroundTask,
  BackgroundTaskAttempt,
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
  type QueueItem,
} from "./constants"

import { subagentSessions } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"
import { formatDuration } from "./duration-formatter"
import {
  buildBackgroundTaskNotificationText,
  type BackgroundTaskNotificationTask,
} from "./background-task-notification-template"
import {
  isAbortedSessionError,
  extractErrorName,
  extractErrorMessage,
  getSessionErrorMessage,
  isRecord,
} from "./error-classifier"
import { tryFallbackRetry } from "./fallback-retry-handler"
import {
  bindAttemptSession,
  ensureCurrentAttempt,
  findAttemptBySession,
  finalizeAttempt,
  getCurrentAttempt,
  startAttempt,
} from "./attempt-lifecycle"
import { registerManagerForCleanup, unregisterManagerForCleanup } from "./process-cleanup"
import { setContinuationMarkerSource } from "../../features/run-continuation-state"
import {
  findNearestMessageExcludingCompaction,
  resolvePromptContextFromSessionMessages,
} from "./compaction-aware-message-resolver"
import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"
import { MESSAGE_STORAGE } from "../hook-message-injector"
import { join } from "node:path"
import { pruneStaleTasksAndNotifications, type SessionStatusMap } from "./task-poller"
import { checkAndInterruptStaleTasks } from "./task-poller"
import { removeTaskToastTracking } from "./remove-task-toast-tracking"
import { abortWithTimeout } from "./abort-with-timeout"
import {
  MIN_SESSION_GONE_POLLS,
  verifySessionExists as verifySessionStillExists,
} from "./session-existence"
import { isActiveSessionStatus, isTerminalSessionStatus } from "./session-status-classifier"
import {
  detectRepetitiveToolUse,
  recordToolCall,
  resolveCircuitBreakerSettings,
  type CircuitBreakerSettings,
} from "./loop-detector"
import {
  createSubagentDepthLimitError,
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

function formatAttemptModelSummary(attempt: Pick<BackgroundTaskAttempt, "providerId" | "modelId"> | undefined): string | undefined {
  if (!attempt?.providerId || !attempt.modelId) {
    return undefined
  }

  return `${attempt.providerId}/${attempt.modelId}`
}

function getPreviousAttempt(task: BackgroundTask, attemptID: string | undefined): BackgroundTaskAttempt | undefined {
  if (!attemptID || !task.attempts || task.attempts.length === 0) {
    return undefined
  }

  const attemptIndex = task.attempts.findIndex((attempt) => attempt.attemptId === attemptID)
  if (attemptIndex <= 0) {
    return undefined
  }

  return task.attempts[attemptIndex - 1]
}

function cloneAttempts(task: BackgroundTask): BackgroundTaskAttempt[] | undefined {
  if (!task.attempts) {
    return undefined
  }

  return task.attempts.map((attempt) => ({ ...attempt }))
}

function buildLocalSessionUrl(directory: string, sessionID: string): string {
  const encodedDirectory = Buffer.from(directory).toString("base64url")
  return `http://127.0.0.1:4096/${encodedDirectory}/session/${sessionID}`
}

export interface SubagentSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>

const MAX_TASK_REMOVAL_RESCHEDULES = 6

export interface BackgroundManagerConfig {
  pluginContext: PluginInput
  config?: BackgroundTaskConfig
  tmuxConfig?: TmuxConfig
  onSubagentSessionCreated?: OnSubagentSessionCreated
  onShutdown?: () => void | Promise<void>
  enableParentSessionNotifications?: boolean
  modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
}

export class BackgroundManager {


  private tasks: Map<string, BackgroundTask>
  private tasksByParentSession: Map<string, Set<string>>
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
  private completedTaskSummaries: Map<string, BackgroundTaskNotificationTask[]> = new Map()
  private idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private notificationQueueByParent: Map<string, Promise<void>> = new Map()
  private observedOutputSessions: Set<string> = new Set()
  private observedIncompleteTodosBySession: Map<string, boolean> = new Map()
  private rootDescendantCounts: Map<string, number>
  private preStartDescendantReservations: Set<string>
  private enableParentSessionNotifications: boolean
  private modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
  private loggedSessionStatusUnavailable = false
  readonly taskHistory = new TaskHistory()
  private cachedCircuitBreakerSettings?: CircuitBreakerSettings

  constructor(config: BackgroundManagerConfig) {
    const { pluginContext, ...options } = config
    this.tasks = new Map()
    this.tasksByParentSession = new Map()
    this.notifications = new Map()
    this.pendingNotifications = new Map()
    this.pendingByParent = new Map()
    this.client = pluginContext.client
    this.directory = pluginContext.directory
    this.concurrencyManager = new ConcurrencyManager(options.config)
    this.config = options.config
    this.tmuxEnabled = options?.tmuxConfig?.enabled ?? false
    this.onSubagentSessionCreated = options?.onSubagentSessionCreated
    this.onShutdown = options?.onShutdown
    this.rootDescendantCounts = new Map()
    this.preStartDescendantReservations = new Set()
    this.enableParentSessionNotifications = options?.enableParentSessionNotifications ?? true
    this.modelFallbackControllerAccessor = options?.modelFallbackControllerAccessor
    this.registerProcessCleanup()
  }

  private async abortSessionWithLogging(sessionID: string, reason: string): Promise<void> {
    try {
      await abortWithTimeout(this.client, sessionID)
    } catch (error) {
      log(`[background-agent] Failed to abort session during ${reason}:`, {
        sessionID,
        error,
      })
    }
  }

  async assertCanSpawn(parentSessionID: string): Promise<SubagentSpawnContext> {
    const spawnContext = await resolveSubagentSpawnContext(this.client, parentSessionID, this.directory)
    const maxDepth = getMaxSubagentDepth(this.config)
    if (spawnContext.childDepth > maxDepth) {
      throw createSubagentDepthLimitError({
        childDepth: spawnContext.childDepth,
        maxDepth,
        parentSessionID,
        rootSessionID: spawnContext.rootSessionID,
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

    if (!task.rootSessionId) {
      return
    }

    this.unregisterRootDescendant(task.rootSessionId)
  }

  private addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
    if (!task.parentSessionId) {
      return
    }

    const taskIDs = this.tasksByParentSession.get(task.parentSessionId) ?? new Set<string>()
    taskIDs.add(task.id)
    this.tasksByParentSession.set(task.parentSessionId, taskIDs)
  }

  private removeTask(task: BackgroundTask): void {
    this.tasks.delete(task.id)
    this.removeTaskFromParentIndex(task.id, task.parentSessionId)
  }

  private updateTaskParent(task: BackgroundTask, parentSessionID: string): void {
    if (task.parentSessionId === parentSessionID) {
      return
    }

    this.removeTaskFromParentIndex(task.id, task.parentSessionId)
    task.parentSessionId = parentSessionID
    const taskIDs = this.tasksByParentSession.get(parentSessionID) ?? new Set<string>()
    taskIDs.add(task.id)
    this.tasksByParentSession.set(parentSessionID, taskIDs)
  }

  private removeTaskFromParentIndex(taskID: string, parentSessionID: string | undefined): void {
    if (!parentSessionID) {
      return
    }

    const taskIDs = this.tasksByParentSession.get(parentSessionID)
    if (!taskIDs) {
      return
    }

    taskIDs.delete(taskID)
    if (taskIDs.size === 0) {
      this.tasksByParentSession.delete(parentSessionID)
    }
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    log("[background-agent] launch() called with:", {
      agent: input.agent,
      model: input.model,
      description: input.description,
      parentSessionID: input.parentSessionId,
    })

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    const spawnReservation = await this.reserveSubagentSpawn(input.parentSessionId)

    try {
      log("[background-agent] spawn guard passed", {
        parentSessionID: input.parentSessionId,
        rootSessionID: spawnReservation.spawnContext.rootSessionID,
        childDepth: spawnReservation.spawnContext.childDepth,
        descendantCount: spawnReservation.descendantCount,
      })

      // Create task immediately with status="pending"
      const task: BackgroundTask = {
        id: `bg_${crypto.randomUUID().slice(0, 8)}`,
        status: "pending",
        queuedAt: new Date(),
        rootSessionId: spawnReservation.spawnContext.rootSessionID,
        // Do NOT set startedAt - will be set when running
        // Do NOT set sessionID - will be set when running
        description: input.description,
        prompt: input.prompt,
        agent: input.agent,
        spawnDepth: spawnReservation.spawnContext.childDepth,
        parentSessionId: input.parentSessionId,
        parentMessageId: input.parentMessageId,
        parentModel: input.parentModel,
        parentAgent: input.parentAgent,
        parentTools: input.parentTools,
        model: input.model,
        fallbackChain: input.fallbackChain,
        attemptCount: 0,
        category: input.category,
      }
      const firstAttempt = startAttempt(task, input.model)

      this.addTask(task)
      this.taskHistory.record(input.parentSessionId, { id: task.id, agent: input.agent, description: input.description, status: "pending", category: input.category })

      // Track for batched notifications immediately (pending state)
      if (input.parentSessionId) {
        const pending = this.pendingByParent.get(input.parentSessionId) ?? new Set()
        pending.add(task.id)
        this.pendingByParent.set(input.parentSessionId, pending)
      }

      // Add to queue
      const key = this.getConcurrencyKeyFromInput(input)
      const queue = this.queuesByKey.get(key) ?? []
      queue.push({ task, input, attemptID: firstAttempt.attemptId })
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

      // Signal CLI run mode that background tasks are active
      this.updateBackgroundTaskMarker(input.parentSessionID)

      // Trigger processing (fire-and-forget)
      void this.processKey(key)

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

          // Mark task as error so the parent polling loop detects the failure
          // instead of leaving it in a zombie "running" state with no prompt sent
          if (item.task.currentAttemptID) {
            finalizeAttempt(item.task, item.task.currentAttemptID, "error", error instanceof Error ? error.message : String(error))
          } else {
            item.task.status = "error"
            item.task.error = error instanceof Error ? error.message : String(error)
            item.task.completedAt = new Date()
          }

          if (item.task.concurrencyKey) {
            this.concurrencyManager.release(item.task.concurrencyKey)
            item.task.concurrencyKey = undefined
          } else {
            this.concurrencyManager.release(key)
          }

          removeTaskToastTracking(item.task.id)

          // Abort the orphaned session if one was created before the error
          if (item.task.sessionId) {
            await this.abortSessionWithLogging(item.task.sessionId, "startTask error cleanup")
          }

          // Update continuation marker for CLI run mode
          this.updateBackgroundTaskMarker(item.task.parentSessionID)

          this.markForNotification(item.task)
          this.enqueueNotificationForParent(item.task.parentSessionId, () => this.notifyParentSession(item.task)).catch(err => {
            log("[background-agent] Failed to notify on startTask error:", err)
          })
        }
      }
    } finally {
      this.processingKeys.delete(key)
    }
  }

  private async startTask(item: QueueItem): Promise<void> {
    const { task, input } = item
    const attemptID = item.attemptID ?? ensureCurrentAttempt(task, input.model).attemptId

    log("[background-agent] Starting task:", {
      taskId: task.id,
      agent: input.agent,
      model: input.model,
    })

    const concurrencyKey = this.getConcurrencyKeyFromInput(input)

    const parentSession = await this.client.session.get({
      path: { id: input.parentSessionId },
      query: { directory: this.directory },
    }).catch((err) => {
      log(`[background-agent] Failed to get parent session: ${err}`)
      return null
    })
    const parentDirectory = parentSession?.data?.directory ?? this.directory
    log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`)

    const createResult = await this.client.session.create({
      body: {
        parentID: input.parentSessionId,
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
      await this.abortSessionWithLogging(sessionID, "cancelled pre-start cleanup")
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
      parentID: input.parentSessionId,
    })

    if (this.onSubagentSessionCreated && this.tmuxEnabled && isInsideTmux()) {
      log("[background-agent] Invoking tmux callback NOW", { sessionID })
      await this.onSubagentSessionCreated({
        sessionID,
        parentID: input.parentSessionId,
        title: input.description,
      }).catch((err) => {
        log("[background-agent] Failed to spawn tmux pane:", err)
      })
      log("[background-agent] tmux callback completed, waiting 200ms")
      await new Promise(r => setTimeout(r, 200))
    } else {
      log("[background-agent] SKIP tmux callback - conditions not met")
    }

    if (this.tasks.get(task.id)?.status === "cancelled") {
      await this.abortSessionWithLogging(sessionID, "cancelled during tmux setup")
      subagentSessions.delete(sessionID)
      if (task.rootSessionId) {
        this.unregisterRootDescendant(task.rootSessionId)
      }
      this.concurrencyManager.release(concurrencyKey)
      return
    }

    const boundAttempt = bindAttemptSession(task, attemptID, sessionID, input.model)
    if (!boundAttempt) {
      await this.abortSessionWithLogging(sessionID, "stale attempt binding cleanup")
      subagentSessions.delete(sessionID)
      if (task.rootSessionId) {
        this.unregisterRootDescendant(task.rootSessionId)
      }
      this.concurrencyManager.release(concurrencyKey)
      return
    }

    task.progress = {
      toolCalls: 0,
      lastUpdate: new Date(),
    }
    task.concurrencyKey = concurrencyKey
    task.concurrencyGroup = concurrencyKey

    if (task.retryNotification) {
      const attemptNumber = boundAttempt.attemptNumber
      const retrySessionUrl = buildLocalSessionUrl(parentDirectory, sessionID)
      const previousAttempt = getPreviousAttempt(task, boundAttempt.attemptId)
      const failedSessionID = previousAttempt?.sessionId ?? task.retryNotification.previousSessionID
      const failedSessionLine = failedSessionID
        ? `\n- Failed session: \`${failedSessionID}\``
        : ""
      const failedModel = formatAttemptModelSummary(previousAttempt) ?? task.retryNotification.failedModel
      const failedModelLine = failedModel
        ? `\n- Failed model: \`${failedModel}\``
        : ""
      const failedError = previousAttempt?.error ?? task.retryNotification.failedError
      const failedErrorLine = failedError
        ? `\n- Error: ${failedError}`
        : ""
      const retryModel = formatAttemptModelSummary(boundAttempt) ?? task.retryNotification.nextModel
      this.queuePendingNotification(
        task.parentSessionId,
        `<system-reminder>
[BACKGROUND TASK RETRY SESSION READY]
**ID:** \`${task.id}\`
**Description:** ${task.description}
**Retry attempt:** ${attemptNumber}
**Retry session:** \`${sessionID}\`
**Retry link:** ${retrySessionUrl}${failedSessionLine}${failedModelLine}${failedErrorLine}${retryModel ? `\n- Model: \`${retryModel}\`` : ""}

The fallback retry session is now created and can be inspected directly.
</system-reminder>`
      )
      task.retryNotification = undefined
    }

    this.taskHistory.record(input.parentSessionId, { id: task.id, sessionID, agent: input.agent, description: input.description, status: "running", category: input.category, startedAt: task.startedAt })
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

    const promptBody = {
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
    }

    promptWithModelSuggestionRetry(this.client, {
      path: { id: sessionID },
      body: promptBody,
    }).catch(async (error) => {
      // Retry with fallback agent if the original agent was unregistered (e.g., after a model switch)
      if (isAgentNotFoundError(error) && input.agent !== FALLBACK_AGENT) {
        log("[background-agent] Agent not found, retrying with fallback agent", {
          original: input.agent,
          fallback: FALLBACK_AGENT,
          taskId: task.id,
        })
        try {
          const fallbackBody = buildFallbackBody(promptBody, FALLBACK_AGENT)
          setSessionTools(sessionID, fallbackBody.tools as Record<string, boolean>)
          await promptWithModelSuggestionRetry(this.client, {
            path: { id: sessionID },
            body: fallbackBody,
          })
          task.agent = FALLBACK_AGENT
          return
        } catch (retryError) {
          log("[background-agent] Fallback agent also failed:", retryError)
        }
      }

      log("[background-agent] promptAsync error:", error)
      const resolvedTask = this.resolveTaskAttemptBySession(sessionID)
      const existingTask = resolvedTask?.task
      if (resolvedTask && !resolvedTask.isCurrent) {
        log("[background-agent] Ignoring prompt error from stale attempt session", {
          sessionID,
          currentAttemptID: resolvedTask.task.currentAttemptID,
          attemptID: resolvedTask.attemptID,
        })
        return
      }
      if (existingTask) {
        const errorInfo = {
          name: extractErrorName(error),
          message: extractErrorMessage(error),
        }
        if (await this.tryFallbackRetry(existingTask, errorInfo, "promptAsync.launch")) {
          return
        }

        const errorMessage = errorInfo.message ?? (error instanceof Error ? error.message : String(error))
        const terminalError = errorMessage.includes("agent.name") || errorMessage.includes("undefined") || isAgentNotFoundError(error)
          ? `Agent "${input.agent}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`
          : errorMessage
        if (existingTask.currentAttemptID) {
          finalizeAttempt(existingTask, existingTask.currentAttemptID, "interrupt", terminalError)
        } else {
          existingTask.status = "interrupt"
          existingTask.error = terminalError
          existingTask.completedAt = new Date()
        }
        if (existingTask.rootSessionId) {
          this.unregisterRootDescendant(existingTask.rootSessionId)
        }
        if (existingTask.concurrencyKey) {
          this.concurrencyManager.release(existingTask.concurrencyKey)
          existingTask.concurrencyKey = undefined
        }

        removeTaskToastTracking(existingTask.id)

        // Abort the session to prevent infinite polling hang
        // Awaited to prevent dangling promise during subagent teardown (Bun/WebKit SIGABRT)
        await this.abortSessionWithLogging(sessionID, "launch error cleanup")

        this.markForNotification(existingTask)
        this.enqueueNotificationForParent(existingTask.parentSessionId, () => this.notifyParentSession(existingTask)).catch(err => {
          log("[background-agent] Failed to notify on error:", err)
        })
      }
    })
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const taskIDs = this.tasksByParentSession.get(sessionID)
    if (!taskIDs) {
      const result: BackgroundTask[] = []
      for (const task of this.tasks.values()) {
        if (task.parentSessionId === sessionID) {
          result.push(task)
        }
      }
      return result
    }

    const tasks: BackgroundTask[] = []
    for (const taskID of taskIDs) {
      const task = this.tasks.get(taskID)
      if (task) {
        tasks.push(task)
      }
    }
    return tasks
  }

  private updateBackgroundTaskMarker(parentSessionID: string): void {
    const tasks = this.getTasksByParentSession(parentSessionID)
    const activeTasks = tasks.filter(t => t.status === "running" || t.status === "pending")
    if (activeTasks.length > 0) {
      setContinuationMarkerSource(
        this.directory, parentSessionID, "background-task", "active",
        `${activeTasks.length} background task(s) active`,
      )
    } else {
      setContinuationMarkerSource(
        this.directory, parentSessionID, "background-task", "idle",
      )
    }
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)

    for (const child of directChildren) {
      result.push(child)
      if (child.sessionId) {
        const descendants = this.getAllDescendantTasks(child.sessionId)
        result.push(...descendants)
      }
    }

    return result
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionID) {
        return task
      }
      if (findAttemptBySession(task, sessionID)) {
        return task
      }
    }
    return undefined
  }

  private resolveTaskAttemptBySession(sessionID: string): { task: BackgroundTask; attemptID?: string; isCurrent: boolean } | undefined {
    const task = this.findBySession(sessionID)
    if (!task) {
      return undefined
    }

    const attempt = findAttemptBySession(task, sessionID)
    if (!attempt) {
      return {
        task,
        attemptID: undefined,
        isCurrent: task.sessionId === sessionID,
      }
    }

    return {
      task,
      attemptID: attempt.attemptId,
      isCurrent: task.currentAttemptID === attempt.attemptId,
    }
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
    sessionId: string
    parentSessionId: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }): Promise<BackgroundTask> {
    const existingTask = this.tasks.get(input.taskId)
    if (existingTask) {
      // P2 fix: Clean up old parent's pending set BEFORE changing parent
      // Otherwise cleanupPendingByParent would use the new parent ID
      const parentChanged = input.parentSessionId !== existingTask.parentSessionId
      if (parentChanged) {
        this.cleanupPendingByParent(existingTask)  // Clean from OLD parent
        this.updateTaskParent(existingTask, input.parentSessionId)
      }
      if (input.parentAgent !== undefined) {
        existingTask.parentAgent = input.parentAgent
      }
      if (!existingTask.concurrencyGroup) {
        existingTask.concurrencyGroup = input.concurrencyKey ?? existingTask.agent
      }

      if (existingTask.sessionId) {
        subagentSessions.add(existingTask.sessionId)
      }
      this.startPolling()

      // Track for batched notifications if task is pending or running
      if (existingTask.status === "pending" || existingTask.status === "running") {
        const pending = this.pendingByParent.get(input.parentSessionId) ?? new Set()
        pending.add(existingTask.id)
        this.pendingByParent.set(input.parentSessionId, pending)
      } else if (!parentChanged) {
        // Only clean up if parent didn't change (already cleaned above if it did)
        this.cleanupPendingByParent(existingTask)
      }

      log("[background-agent] External task already registered:", { taskId: existingTask.id, sessionID: existingTask.sessionId, status: existingTask.status })

      return existingTask
    }

    const concurrencyGroup = input.concurrencyKey ?? input.agent ?? "task"

    // Acquire concurrency slot if a key is provided
    if (input.concurrencyKey) {
      await this.concurrencyManager.acquire(input.concurrencyKey)
    }

    const task: BackgroundTask = {
      id: input.taskId,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      parentMessageId: "",
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

    this.addTask(task)
    subagentSessions.add(input.sessionId)
    this.startPolling()
    this.taskHistory.record(input.parentSessionId, { id: task.id, sessionID: input.sessionId, agent: input.agent || "task", description: input.description, status: "running", startedAt: task.startedAt })

    if (input.parentSessionId) {
      const pending = this.pendingByParent.get(input.parentSessionId) ?? new Set()
      pending.add(task.id)
      this.pendingByParent.set(input.parentSessionId, pending)
    }

    log("[background-agent] Registered external task:", { taskId: task.id, sessionID: input.sessionId })

    return task
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    if (!existingTask.sessionId) {
      throw new Error(`Task has no sessionID: ${existingTask.id}`)
    }

    if (existingTask.status === "running") {
      log("[background-agent] Resume skipped - task already running:", {
        taskId: existingTask.id,
        sessionID: existingTask.sessionId,
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
    this.updateTaskParent(existingTask, input.parentSessionId)
    existingTask.parentMessageId = input.parentMessageId
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
    if (existingTask.sessionId) {
      subagentSessions.add(existingTask.sessionId)
    }

    if (input.parentSessionId) {
      const pending = this.pendingByParent.get(input.parentSessionId) ?? new Set()
      pending.add(existingTask.id)
      this.pendingByParent.set(input.parentSessionId, pending)
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

    log("[background-agent] Resuming task:", { taskId: existingTask.id, sessionID: existingTask.sessionId })

    log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
      sessionID: existingTask.sessionId,
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
      applySessionPromptParams(existingTask.sessionId!, existingTask.model)
    }

    this.client.session.promptAsync({
      path: { id: existingTask.sessionId },
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
          setSessionTools(existingTask.sessionId!, tools)
          return tools
        })(),
        parts: [createInternalAgentTextPart(input.prompt)],
      },
    }).catch(async (error) => {
      log("[background-agent] resume prompt error:", error)
      const errorInfo = {
        name: extractErrorName(error),
        message: extractErrorMessage(error),
      }
      if (await this.tryFallbackRetry(existingTask, errorInfo, "promptAsync.resume")) {
        return
      }

      existingTask.status = "interrupt"
      const errorMessage = errorInfo.message ?? (error instanceof Error ? error.message : String(error))
      existingTask.error = errorMessage
      existingTask.completedAt = new Date()
      if (existingTask.rootSessionId) {
        this.unregisterRootDescendant(existingTask.rootSessionId)
      }

      // Release concurrency on error to prevent slot leaks
      if (existingTask.concurrencyKey) {
        this.concurrencyManager.release(existingTask.concurrencyKey)
        existingTask.concurrencyKey = undefined
      }

      removeTaskToastTracking(existingTask.id)

      // Abort the session to prevent infinite polling hang
      // Awaited to prevent dangling promise during subagent teardown (Bun/WebKit SIGABRT)
      if (existingTask.sessionId) {
        await this.abortSessionWithLogging(existingTask.sessionId, "resume error cleanup")
      }

      this.markForNotification(existingTask)
      this.enqueueNotificationForParent(existingTask.parentSessionId, () => this.notifyParentSession(existingTask)).catch(err => {
        log("[background-agent] Failed to notify on resume error:", err)
      })
    })

    return existingTask
  }

  private async checkSessionTodos(sessionID: string): Promise<boolean> {
    const observedIncompleteTodos = this.observedIncompleteTodosBySession.get(sessionID)
    if (observedIncompleteTodos !== undefined) {
      return observedIncompleteTodos
    }

    try {
      const response = await this.client.session.todo({
        path: { id: sessionID },
      })
      const todos = normalizeSDKResponse(response, [] as Todo[], { preferResponseOnMissingData: true })
      if (!todos || todos.length === 0) {
        this.observedIncompleteTodosBySession.set(sessionID, false)
        return false
      }

      const incomplete = todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      )
      const hasIncompleteTodos = incomplete.length > 0
      this.observedIncompleteTodosBySession.set(sessionID, hasIncompleteTodos)
      return hasIncompleteTodos
    } catch (error) {
      log("[background-agent] Failed to check session todos:", {
        sessionID,
        error,
      })
      return false
    }
  }

  private markSessionOutputObserved(sessionID: string): void {
    this.observedOutputSessions.add(sessionID)
  }

  private clearSessionOutputObserved(sessionID: string): void {
    this.observedOutputSessions.delete(sessionID)
  }

  private clearSessionTodoObservation(sessionID: string): void {
    this.observedIncompleteTodosBySession.delete(sessionID)
  }

  private hasOutputSignalFromPart(partInfo: MessagePartInfo | undefined): boolean {
    if (!partInfo?.sessionID) return false
    if (partInfo.tool) return true
    if (partInfo.type === "tool" || partInfo.type === "tool_result") return true
    if (partInfo.type === "text" || partInfo.type === "reasoning") return true

    const field = typeof (partInfo as { field?: unknown }).field === "string"
      ? (partInfo as { field?: string }).field
      : undefined
    return field === "text" || field === "reasoning"
  }

  handleEvent(event: Event): void {
    const props = event.properties

    if (event.type === "message.updated") {
      const info = props?.info
      if (!info || typeof info !== "object") return

      const sessionID = (info as Record<string, unknown>)["sessionID"]
      const role = (info as Record<string, unknown>)["role"]
      if (typeof sessionID !== "string") return

      if (role === "tool") {
        this.markSessionOutputObserved(sessionID)
      }

      if (role !== "assistant") return

      const resolved = this.resolveTaskAttemptBySession(sessionID)
      if (!resolved?.isCurrent) return

      const { task } = resolved
      if (task.status !== "running") return

      const assistantError = (info as Record<string, unknown>)["error"]
      if (!assistantError) return

      const errorInfo = {
        name: extractErrorName(assistantError),
        message: extractErrorMessage(assistantError),
      }
      void this.tryFallbackRetry(task, errorInfo, "message.updated").catch((error) => {
        log("[background-agent] Error handling message.updated fallback retry:", {
          error,
          taskId: task.id,
        })
      })
    }

    if (event.type === "message.part.updated" || event.type === "message.part.delta") {
      const partInfo = resolveMessagePartInfo(props)
      const sessionID = partInfo?.sessionID
      if (!sessionID) return

      const resolved = this.resolveTaskAttemptBySession(sessionID)
      if (!resolved?.isCurrent) return

      const { task } = resolved

      if (this.hasOutputSignalFromPart(partInfo)) {
        this.markSessionOutputObserved(sessionID)
      }

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
         const circuitBreaker = this.cachedCircuitBreakerSettings ?? resolveCircuitBreakerSettings(this.config)
         this.cachedCircuitBreakerSettings = circuitBreaker
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

    if (event.type === "todo.updated") {
      const sessionID = typeof props?.sessionID === "string" ? props.sessionID : undefined
      const todos = Array.isArray(props?.todos) ? props.todos : undefined
      if (!sessionID || !todos) return

      const hasIncompleteTodos = todos.some((todo) => {
        if (!todo || typeof todo !== "object") return false
        const status = (todo as { status?: unknown }).status
        return status !== "completed" && status !== "cancelled"
      })
      this.observedIncompleteTodosBySession.set(sessionID, hasIncompleteTodos)
      return
    }

    if (event.type === "session.idle") {
      if (!props || typeof props !== "object") return
      handleSessionIdleBackgroundEvent({
        properties: props as Record<string, unknown>,
        findBySession: (id) => {
          const resolved = this.resolveTaskAttemptBySession(id)
          return resolved?.isCurrent ? resolved.task : undefined
        },
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

      const resolved = this.resolveTaskAttemptBySession(sessionID)
      if (!resolved?.isCurrent) return

      const { task } = resolved
      if (task.status !== "running") return

      const errorObj = props?.error as { name?: string; message?: string } | undefined
      const errorName = errorObj?.name
      const errorMessage = props ? getSessionErrorMessage(props) : undefined

      const errorInfo = { name: errorName, message: errorMessage }
      void this.handleSessionErrorEvent({
        errorInfo,
        errorMessage,
        errorName,
        task,
      }).catch((error) => {
        log("[background-agent] Error handling session.error event:", {
          error,
          taskId: task.id,
        })
      })
      return
    }

    if (event.type === "session.deleted") {
      const info = props?.info
      if (!info || typeof info.id !== "string") return
      const sessionID = info.id
      this.clearSessionOutputObserved(sessionID)
      this.clearSessionTodoObservation(sessionID)

      const tasksToCancel = new Map<string, BackgroundTask>()
      const directTask = this.resolveTaskAttemptBySession(sessionID)
      if (directTask?.isCurrent) {
        tasksToCancel.set(directTask.task.id, directTask.task)
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
        if (task.sessionId) {
          deletedSessionIDs.add(task.sessionId)
        }
      }

      for (const task of tasksToCancel.values()) {
        parentSessionsToClear.add(task.parentSessionId)

        if (task.status === "running" || task.status === "pending") {
          void this.cancelTask(task.id, {
            source: "session.deleted",
            reason: "Session deleted",
          }).then(() => {
            if (deletedSessionIDs.has(task.parentSessionId)) {
              this.pendingNotifications.delete(task.parentSessionId)
            }
          }).catch(err => {
            if (deletedSessionIDs.has(task.parentSessionId)) {
              this.pendingNotifications.delete(task.parentSessionId)
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

      const resolved = this.resolveTaskAttemptBySession(sessionID)
      if (!resolved?.isCurrent) return

      const { task } = resolved
      if (task.status !== "running") return

      const errorMessage = typeof status.message === "string" ? status.message : undefined
      const errorInfo = { name: "SessionRetry", message: errorMessage }
      void this.tryFallbackRetry(task, errorInfo, "session.status").catch((error) => {
        log("[background-agent] Error handling session.status fallback retry:", {
          error,
          taskId: task.id,
        })
      })
    }
  }

  private async handleSessionErrorEvent(args: {
    task: BackgroundTask
    errorInfo: { name?: string; message?: string }
    errorName: string | undefined
    errorMessage: string | undefined
  }): Promise<void> {
    const { task, errorInfo, errorMessage, errorName } = args

    if (!task.fallbackChain && task.sessionId) {
      const sessionFallbackChain = this.modelFallbackControllerAccessor?.getSessionFallbackChain(task.sessionId)
      if (sessionFallbackChain?.length) {
        task.fallbackChain = sessionFallbackChain
      }
    }

    // Agent-not-found errors are handled by the prompt catch block with agent fallback.
    // Do not also trigger model fallback retry — that would race with the agent retry.
    if (isAgentNotFoundError({ message: errorInfo.message } as Error)) {
      log("[background-agent] Skipping session.error fallback for agent-not-found (handled by prompt catch)", {
        taskId: task.id,
        errorMessage: errorInfo.message?.slice(0, 100),
      })
      return
    }

    if (await this.tryFallbackRetry(task, errorInfo, "session.error")) {
      return
    }

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

    if (task.currentAttemptID) {
      finalizeAttempt(task, task.currentAttemptID, "error", errorMsg)
    } else {
      task.status = "error"
      task.error = errorMsg
      task.completedAt = new Date()
    }
    if (task.rootSessionId) {
      this.unregisterRootDescendant(task.rootSessionId)
    }
    this.taskHistory.record(task.parentSessionId, { id: task.id, sessionID: task.sessionId, agent: task.agent, description: task.description, status: "error", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })

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
    if (task.sessionId) {
      SessionCategoryRegistry.remove(task.sessionId)
    }

    // Update continuation marker for CLI run mode
    if (task.parentSessionID) {
      this.updateBackgroundTaskMarker(task.parentSessionID)
    }

    this.markForNotification(task)
    this.enqueueNotificationForParent(task.parentSessionId, () => this.notifyParentSession(task)).catch(err => {
      log("[background-agent] Error in notifyParentSession for errored task:", { taskId: task.id, error: err })
    })
  }

  private tryFallbackRetry(
    task: BackgroundTask,
    errorInfo: { name?: string; message?: string },
    source: string,
  ): Promise<boolean> {
    const previousSessionID = task.sessionId
    const result = tryFallbackRetry({
      task,
      errorInfo,
      source,
      concurrencyManager: this.concurrencyManager,
      client: this.client,
      idleDeferralTimers: this.idleDeferralTimers,
      queuesByKey: this.queuesByKey,
      processKey: (key: string) => this.processKey(key),
      onRetrying: ({ task, source }) => {
        const currentAttempt = getCurrentAttempt(task)
        const previousAttempt = getPreviousAttempt(task, currentAttempt?.attemptId)
        const sourceText = source ? ` via ${source}` : ""
        const failedSessionLine = previousAttempt?.sessionId ? `\n- Failed session: \`${previousAttempt.sessionId}\`` : ""
        const failedModel = formatAttemptModelSummary(previousAttempt)
        const failedModelLine = failedModel ? `\n- Failed model: \`${failedModel}\`` : ""
        const failedErrorLine = previousAttempt?.error ? `\n- Error: ${previousAttempt.error}` : ""
        const nextModel = formatAttemptModelSummary(currentAttempt)
        this.queuePendingNotification(
          task.parentSessionId,
          `<system-reminder>
[BACKGROUND TASK RETRYING]
**ID:** \`${task.id}\`
**Description:** ${task.description}${sourceText}${failedSessionLine}${failedModelLine}${failedErrorLine}${nextModel ? `\n- Next model: \`${nextModel}\`` : ""}

The task was re-queued on a fallback model after a retryable failure.
</system-reminder>`
        )
      },
    })
    return result.then((retried) => {
      if (retried && previousSessionID) {
        this.clearSessionOutputObserved(previousSessionID)
        this.clearSessionTodoObservation(previousSessionID)
        subagentSessions.delete(previousSessionID)
      }
      return retried
    })
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionId) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionId, queue)
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
    if (this.observedOutputSessions.has(sessionID)) {
      return true
    }

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

      this.markSessionOutputObserved(sessionID)
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
    if (!task.parentSessionId) return
    const pending = this.pendingByParent.get(task.parentSessionId)
    if (pending) {
      pending.delete(task.id)
      if (pending.size === 0) {
        this.pendingByParent.delete(task.parentSessionId)
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

      if (task.parentSessionId) {
        const siblings = this.getTasksByParentSession(task.parentSessionId)
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
      this.removeTask(task)
      this.clearTaskHistoryWhenParentTasksGone(task.parentSessionId)
      if (task.sessionId) {
        subagentSessions.delete(task.sessionId)
        SessionCategoryRegistry.remove(task.sessionId)
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
    if (task.currentAttemptID) {
      finalizeAttempt(task, task.currentAttemptID, "cancelled", reason)
    } else {
      task.status = "cancelled"
      task.completedAt = new Date()
      if (reason) {
        task.error = reason
      }
    }
    if (wasRunning && task.rootSessionId) {
      this.unregisterRootDescendant(task.rootSessionId)
    }
    this.taskHistory.record(task.parentSessionId, { id: task.id, sessionID: task.sessionId, agent: task.agent, description: task.description, status: "cancelled", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })

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

    if (abortSession && task.sessionId) {
      // Awaited to prevent dangling promise during subagent teardown (Bun/WebKit SIGABRT)
      await this.abortSessionWithLogging(task.sessionId, `task cancellation (${source})`)

      SessionCategoryRegistry.remove(task.sessionId)
    }

    removeTaskToastTracking(task.id)

    // Update continuation marker for CLI run mode
    if (task.parentSessionID) {
      this.updateBackgroundTaskMarker(task.parentSessionID)
    }

    if (options?.skipNotification) {
      this.cleanupPendingByParent(task)
      this.scheduleTaskRemoval(task.id)
      log(`[background-agent] Task cancelled via ${source} (notification skipped):`, task.id)
      return true
    }

    this.markForNotification(task)

    try {
      await this.enqueueNotificationForParent(task.parentSessionId, () => this.notifyParentSession(task))
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
    if (task.currentAttemptID) {
      finalizeAttempt(task, task.currentAttemptID, "completed")
    } else {
      task.status = "completed"
      task.completedAt = new Date()
    }
    this.taskHistory.record(task.parentSessionId, { id: task.id, sessionID: task.sessionId, agent: task.agent, description: task.description, status: "completed", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })

    if (task.rootSessionId) {
      this.unregisterRootDescendant(task.rootSessionId)
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

    if (task.sessionId) {
      // Awaited to prevent dangling promise during subagent teardown (Bun/WebKit SIGABRT)
      await this.abortSessionWithLogging(task.sessionId, `task completion (${source})`)

      SessionCategoryRegistry.remove(task.sessionId)
    }

    // Update continuation marker for CLI run mode
    if (task.parentSessionID) {
      this.updateBackgroundTaskMarker(task.parentSessionID)
    }

    try {
      await this.enqueueNotificationForParent(task.parentSessionId, () => this.notifyParentSession(task))
      log(`[background-agent] Task completed via ${source}:`, task.id)
    } catch (err) {
      log("[background-agent] Error in notifyParentSession:", { taskId: task.id, error: err })
      // Concurrency already released, notification failed but task is complete
    }

    return true
  }

  private async notifyParentSession(task: BackgroundTask): Promise<void> {
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

    if (!this.completedTaskSummaries.has(task.parentSessionId)) {
      this.completedTaskSummaries.set(task.parentSessionId, [])
    }
    this.completedTaskSummaries.get(task.parentSessionId)!.push({
      id: task.id,
      description: task.description,
      status: task.status,
      error: task.error,
      attempts: cloneAttempts(task),
    })

    // Update pending tracking and check if all tasks complete
    const pendingSet = this.pendingByParent.get(task.parentSessionId)
    let allComplete = false
    let remainingCount = 0
    if (pendingSet) {
      pendingSet.delete(task.id)
      remainingCount = pendingSet.size
      allComplete = remainingCount === 0
      if (allComplete) {
        this.pendingByParent.delete(task.parentSessionId)
      }
    } else {
      remainingCount = Array.from(this.tasks.values())
        .filter(t => t.parentSessionId === task.parentSessionId && t.id !== task.id && (t.status === "running" || t.status === "pending"))
        .length
      allComplete = remainingCount === 0
    }

    const completedTasks = allComplete
      ? (this.completedTaskSummaries.get(task.parentSessionId) ?? [{ id: task.id, description: task.description, status: task.status, error: task.error, attempts: cloneAttempts(task) }])
      : []

    if (allComplete) {
      this.completedTaskSummaries.delete(task.parentSessionId)
    }

    const statusText = task.status === "completed"
      ? "COMPLETED"
      : task.status === "interrupt"
        ? "INTERRUPTED"
        : task.status === "error"
          ? "ERROR"
          : "CANCELLED"
    const notification = buildBackgroundTaskNotificationText({
      task,
      duration,
      statusText,
      allComplete,
      remainingCount,
      completedTasks,
    })

      let agent: string | undefined = task.parentAgent
      let model: { providerID: string; modelID: string } | undefined
      let tools: Record<string, boolean> | undefined = task.parentTools
      let promptContext: ReturnType<typeof resolvePromptContextFromSessionMessages> = null

      if (this.enableParentSessionNotifications) {
        try {
          const messagesResp = await this.client.session.messages({ path: { id: task.parentSessionId } })
          const messages = normalizeSDKResponse(messagesResp, [] as Array<{
            info?: {
              agent?: string
              model?: { providerID: string; modelID: string }
              modelID?: string
              providerID?: string
              tools?: Record<string, boolean | "allow" | "deny" | "ask">
            }
          }>)
          promptContext = resolvePromptContextFromSessionMessages(
            messages,
            task.parentSessionId,
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
              parentSessionID: task.parentSessionId,
            })
          }
          const messageDir = join(MESSAGE_STORAGE, task.parentSessionId)
          const currentMessage = messageDir
            ? findNearestMessageExcludingCompaction(messageDir, task.parentSessionId)
            : null
          agent = currentMessage?.agent ?? task.parentAgent
          model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
            ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
            : undefined
          tools = normalizePromptTools(currentMessage?.tools) ?? tools
        }

        const resolvedTools = resolveInheritedPromptTools(task.parentSessionId, tools)

        log("[background-agent] notifyParentSession context:", {
          taskId: task.id,
          resolvedAgent: agent,
          resolvedModel: model,
        })

        const isTaskFailure = task.status === "error" || task.status === "cancelled" || task.status === "interrupt"
        const shouldReply = allComplete || isTaskFailure

        const variant = promptContext?.model?.variant

        try {
          await this.client.session.promptAsync({
            path: { id: task.parentSessionId },
            body: {
              noReply: !shouldReply,
              ...(agent !== undefined ? { agent } : {}),
              ...(model !== undefined ? { model } : {}),
              ...(variant !== undefined ? { variant } : {}),
              ...(resolvedTools ? { tools: resolvedTools } : {}),
              parts: [createInternalAgentTextPart(notification)],
            },
          })
          log("[background-agent] Sent notification to parent session:", {
            taskId: task.id,
            allComplete,
            isTaskFailure,
            noReply: !shouldReply,
          })
        } catch (error) {
          if (isAbortedSessionError(error)) {
            log("[background-agent] Parent session aborted while sending notification; continuing cleanup:", {
              taskId: task.id,
              parentSessionID: task.parentSessionId,
            })
            this.queuePendingNotification(task.parentSessionId, notification)
          } else {
            log("[background-agent] Failed to send notification:", error)
          }
        }
      } else {
        log("[background-agent] Parent session notifications disabled, skipping prompt injection:", {
          taskId: task.id,
          parentSessionID: task.parentSessionId,
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
      taskTtlMs: this.config?.taskTtlMs,
      onTaskPruned: (taskId, task, errorMessage) => {
        const wasPending = task.status === "pending"
        log("[background-agent] Pruning stale task:", { taskId, status: task.status, age: Math.round(((wasPending ? task.queuedAt?.getTime() : task.startedAt?.getTime()) ? (Date.now() - (wasPending ? task.queuedAt!.getTime() : task.startedAt!.getTime())) : 0) / 1000) + "s" })
        task.status = "error"
        task.error = errorMessage
        task.completedAt = new Date()
        if (!wasPending && task.rootSessionId) {
          this.unregisterRootDescendant(task.rootSessionId)
        }
        this.taskHistory.record(task.parentSessionId, { id: task.id, sessionID: task.sessionId, agent: task.agent, description: task.description, status: "error", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })
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
        // Update continuation marker for CLI run mode
        if (task.parentSessionID) {
          this.updateBackgroundTaskMarker(task.parentSessionID)
        }
        this.markForNotification(task)
        this.enqueueNotificationForParent(task.parentSessionId, () => this.notifyParentSession(task)).catch(err => {
          log("[background-agent] Error in notifyParentSession for stale-pruned task:", { taskId: task.id, error: err })
        })
      },
    })
  }

  private async checkAndInterruptStaleTasks(
    allStatuses: SessionStatusMap | undefined,
  ): Promise<void> {
    await checkAndInterruptStaleTasks({
      tasks: this.tasks.values(),
      client: this.client,
      directory: this.directory,
      config: this.config,
      concurrencyManager: this.concurrencyManager,
      notifyParentSession: (task) => this.enqueueNotificationForParent(task.parentSessionId, () => this.notifyParentSession(task)),
      sessionStatuses: allStatuses,
    })
  }

  private async verifySessionExists(sessionID: string): Promise<boolean> {
    return verifySessionStillExists(this.client, sessionID, this.directory)
  }

  private async failCrashedTask(task: BackgroundTask, errorMessage: string): Promise<void> {
    if (task.currentAttemptID) {
      finalizeAttempt(task, task.currentAttemptID, "error", errorMessage)
    } else {
      task.status = "error"
      task.error = errorMessage
      task.completedAt = new Date()
    }
    if (task.rootSessionId) {
      this.unregisterRootDescendant(task.rootSessionId)
    }
    this.taskHistory.record(task.parentSessionId, { id: task.id, sessionID: task.sessionId, agent: task.agent, description: task.description, status: "error", category: task.category, startedAt: task.startedAt, completedAt: task.completedAt })
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
    removeTaskToastTracking(task.id)
    this.scheduleTaskRemoval(task.id)
    if (task.sessionId) {
      SessionCategoryRegistry.remove(task.sessionId)
    }

    // Update continuation marker for CLI run mode
    if (task.parentSessionID) {
      this.updateBackgroundTaskMarker(task.parentSessionID)
    }

    this.markForNotification(task)
    this.enqueueNotificationForParent(task.parentSessionId, () => this.notifyParentSession(task)).catch(err => {
      log("[background-agent] Error in notifyParentSession for crashed task:", { taskId: task.id, error: err })
    })
  }

  private async pollRunningTasks(): Promise<void> {
    if (this.pollingInFlight) return
    this.pollingInFlight = true
    try {
      this.pruneStaleTasksAndNotifications()

      let allStatuses: SessionStatusMap | undefined
      const sessionStatusMethod = this.client?.session?.status
      if (typeof sessionStatusMethod !== "function") {
        if (!this.loggedSessionStatusUnavailable) {
          log("[background-agent] Unable to poll session statuses:", {
            reason: "session.status unavailable",
          })
          this.loggedSessionStatusUnavailable = true
        }
      } else {
        try {
          const statusResult = await this.client.session.status()
          allStatuses = normalizeSDKResponse(statusResult, {})
        } catch (error) {
          if (!this.loggedSessionStatusUnavailable) {
            log("[background-agent] Error polling session statuses:", { error })
            this.loggedSessionStatusUnavailable = true
          }
        }
      }

      await this.checkAndInterruptStaleTasks(allStatuses)

      for (const task of this.tasks.values()) {
        if (task.status !== "running") continue
        
        const sessionID = task.sessionId
        if (!sessionID) continue

        try {
          const sessionStatus = allStatuses?.[sessionID]
          // Handle retry before checking running state
          if (sessionStatus?.type === "retry") {
            const retryMessage = typeof (sessionStatus as { message?: string }).message === "string"
              ? (sessionStatus as { message?: string }).message
              : undefined
            const errorInfo = { name: "SessionRetry", message: retryMessage }
            if (await this.tryFallbackRetry(task, errorInfo, "polling:session.status")) {
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

          if (sessionStatus && isTerminalSessionStatus(sessionStatus.type)) {
            await this.tryCompleteTask(task, `polling (terminal session status: ${sessionStatus.type})`)
            continue
          }

          if (sessionStatus && sessionStatus.type !== "idle") {
            log("[background-agent] Unknown session status, treating as potentially idle:", {
              taskId: task.id,
              sessionID,
              sessionStatus: sessionStatus.type,
            })
          }

          if (allStatuses === undefined) {
            continue
          }

          // Session is idle or no longer in status response (completed/disappeared)
          const sessionGoneFromStatus = allStatuses !== undefined && !sessionStatus
          const sessionGoneThresholdReached = sessionGoneFromStatus
            && (task.consecutiveMissedPolls ?? 0) >= MIN_SESSION_GONE_POLLS
          const completionSource = sessionStatus?.type === "idle"
            ? "polling (idle status)"
            : "polling (session gone from status)"
          const hasValidOutput = await this.validateSessionHasOutput(sessionID)
          if (!hasValidOutput) {
            if (sessionGoneThresholdReached) {
              const sessionExists = await this.verifySessionExists(sessionID)
              if (!sessionExists) {
                log("[background-agent] Session no longer exists (crashed), marking task as error:", task.id)
                await this.failCrashedTask(task, "Subagent session no longer exists (process likely crashed). The session disappeared without producing any output.")
                continue
              }

              task.consecutiveMissedPolls = 0
            }
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
    const abortRequests: Array<{ sessionID: string; promise: Promise<unknown> }> = []

    // Abort all running sessions to prevent zombie processes (#1240)
    for (const task of this.tasks.values()) {
      if (task.sessionId) {
        trackedSessionIDs.add(task.sessionId)
      }

      if (task.status === "running" && task.sessionId) {
        abortRequests.push({
          sessionID: task.sessionId,
          promise: abortWithTimeout(this.client, task.sessionId),
        })
      }
    }

    if (abortRequests.length > 0) {
      const abortResults = await Promise.allSettled(abortRequests.map((request) => request.promise))
      for (const [index, abortResult] of abortResults.entries()) {
        if (abortResult.status === "fulfilled") continue

        log("[background-agent] Error aborting session during shutdown:", {
          error: abortResult.reason,
          sessionID: abortRequests[index]?.sessionID,
        })
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
    this.tasksByParentSession.clear()
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
    const cleanupQueueEntry = (): void => {
      if (this.notificationQueueByParent.get(parentSessionID) === current) {
        this.notificationQueueByParent.delete(parentSessionID)
      }
    }

    const current = previous
      .catch((error) => {
        log("[background-agent] Continuing notification queue after previous failure:", {
          parentSessionID,
          error,
        })
      })
      .then(operation)

    this.notificationQueueByParent.set(parentSessionID, current)

    void current.then(cleanupQueueEntry, cleanupQueueEntry)

    return current
  }
}
