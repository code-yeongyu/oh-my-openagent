/**
 * Background Agent Debug Logger
 *
 * Comprehensive debugging for background agents covering:
 * - Model used for spawning
 * - Session creation/lifecycle data
 * - Prompt and response tracking
 * - Error tracking with context
 * - Hanging/timeout detection
 *
 * Enable with OMO_DEBUG_BACKGROUND=1 environment variable.
 * Logs are written to a separate file for easy PR isolation.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"

// Environment toggle for debug logging
const DEBUG_ENABLED = process.env.OMO_DEBUG_BACKGROUND === "1"

// Separate log file for background agent debugging
const DEBUG_LOG_FILE = path.join(
  "C:\\Users\\li859\\Documents\\Personal-projects\\omo_debugging_logs",
  "oh-my-opencode-background-debug.log"
)

// Maximum events to keep in circular buffer (for getRecentEvents)
const MAX_BUFFER_SIZE = 500

/**
 * Event types for structured logging
 */
export type DebugEventType =
  | "spawn_start"
  | "spawn_session_created"
  | "spawn_prompt_sent"
  | "spawn_complete"
  | "spawn_error"
  | "resume_start"
  | "resume_prompt_sent"
  | "resume_complete"
  | "resume_error"
  | "resume_timing_reset"
  | "session_idle"
  | "session_idle_ignored"
  | "session_completed"
  | "session_deleted"
  | "session_error"
  | "session_timeout"
  | "event_received"
  | "polling_tick"
  | "polling_status"
  | "stability_check"
  | "stability_complete"
  | "todo_check"
  | "output_validation"
  | "notification_sent"
  | "timeout_warning"
  | "global_timeout"
  | "concurrency_acquired"
  | "concurrency_released"
  | "concurrency_double_release_prevented"
  | "pending_parent_cleanup"
  | "pending_parent_update"
  | "memory_snapshot"
  | "memory_leak_warning"
  | "task_pruned"
  | "auth_status"
  | "client_created"
  | "http_request"
  | "http_response"
  | "http_error"
  | "model_resolved"

/**
 * Structured debug event
 */
export interface DebugEvent {
  timestamp: string
  type: DebugEventType
  taskId?: string
  sessionId?: string
  parentSessionId?: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  parentModel?: { providerID: string; modelID: string }
  duration?: number
  elapsedMs?: number
  status?: string
  error?: string
  errorStack?: string
  details?: Record<string, unknown>
}

/**
 * Circular buffer for recent events
 */
class CircularBuffer<T> {
  private buffer: T[] = []
  private pointer = 0
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  push(item: T): void {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(item)
    } else {
      this.buffer[this.pointer] = item
      this.pointer = (this.pointer + 1) % this.maxSize
    }
  }

  getAll(): T[] {
    if (this.buffer.length < this.maxSize) {
      return [...this.buffer]
    }
    // Return in chronological order
    return [
      ...this.buffer.slice(this.pointer),
      ...this.buffer.slice(0, this.pointer),
    ]
  }

  clear(): void {
    this.buffer = []
    this.pointer = 0
  }
}

/**
 * Background Agent Debug Logger
 *
 * Singleton class for comprehensive background agent debugging.
 * All methods are no-ops when DEBUG_ENABLED is false.
 */
class BackgroundAgentDebugLogger {
  private static instance: BackgroundAgentDebugLogger
  private eventBuffer: CircularBuffer<DebugEvent>
  private taskStartTimes: Map<string, number> = new Map()

  private constructor() {
    this.eventBuffer = new CircularBuffer(MAX_BUFFER_SIZE)
    if (DEBUG_ENABLED) {
      this.writeToFile({
        timestamp: new Date().toISOString(),
        type: "client_created",
        details: {
          message: "Debug logger initialized",
          debugEnabled: DEBUG_ENABLED,
          logFile: DEBUG_LOG_FILE,
        },
      })
    }
  }

  static getInstance(): BackgroundAgentDebugLogger {
    if (!BackgroundAgentDebugLogger.instance) {
      BackgroundAgentDebugLogger.instance = new BackgroundAgentDebugLogger()
    }
    return BackgroundAgentDebugLogger.instance
  }

  /**
   * Write event to log file
   */
  private writeToFile(event: DebugEvent): void {
    if (!DEBUG_ENABLED) return

    try {
      const logLine = JSON.stringify(event) + "\n"
      fs.appendFileSync(DEBUG_LOG_FILE, logLine)
    } catch {
      // Silently fail - don't break agents over logging
    }
  }

  /**
   * Log an event (stores in buffer and writes to file if debug enabled)
   */
  private logEvent(event: DebugEvent): void {
    this.eventBuffer.push(event)
    this.writeToFile(event)
  }

  // ===============================================
  // SPAWN TRACKING
  // ===============================================

  /**
   * Log when a spawn operation starts
   */
  logSpawnStart(input: LaunchInput, taskId?: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "spawn_start",
      taskId,
      parentSessionId: input.parentSessionID,
      agent: input.agent,
      model: input.model,
      parentModel: input.parentModel,
      details: {
        description: input.description,
        promptLength: input.prompt.length,
        hasSkillContent: !!input.skillContent,
        skills: input.skills,
        parentAgent: input.parentAgent,
      },
    }

    if (taskId) {
      this.taskStartTimes.set(taskId, Date.now())
    }

    this.logEvent(event)
  }

  /**
   * Log when session is created for the spawn
   */
  logSessionCreated(
    taskId: string,
    sessionId: string,
    parentSessionId: string,
    parentDirectory: string
  ): void {
    const startTime = this.taskStartTimes.get(taskId)
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "spawn_session_created",
      taskId,
      sessionId,
      parentSessionId,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
      details: {
        parentDirectory,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log when prompt is sent to the spawned session
   */
  logPromptSent(
    taskId: string,
    sessionId: string,
    agent: string,
    model?: { providerID: string; modelID: string; variant?: string },
    promptLength?: number
  ): void {
    const startTime = this.taskStartTimes.get(taskId)
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "spawn_prompt_sent",
      taskId,
      sessionId,
      agent,
      model,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
      details: {
        promptLength,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log successful spawn completion
   */
  logSpawnComplete(task: BackgroundTask): void {
    const startTime = this.taskStartTimes.get(task.id)
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "spawn_complete",
      taskId: task.id,
      sessionId: task.sessionID,
      parentSessionId: task.parentSessionID,
      agent: task.agent,
      model: task.model,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
      status: task.status,
      details: {
        concurrencyKey: task.concurrencyKey,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log spawn error
   */
  logSpawnError(
    taskId: string | undefined,
    sessionId: string | undefined,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    const startTime = taskId ? this.taskStartTimes.get(taskId) : undefined
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "spawn_error",
      taskId,
      sessionId,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
      error: errorMessage,
      errorStack,
      details: context,
    }
    this.logEvent(event)

    if (taskId) {
      this.taskStartTimes.delete(taskId)
    }
  }

  // ===============================================
  // RESUME TRACKING
  // ===============================================

  /**
   * Log when a resume operation starts
   */
  logResumeStart(input: ResumeInput, taskId: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "resume_start",
      taskId,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionID,
      parentModel: input.parentModel,
      details: {
        promptLength: input.prompt.length,
        parentAgent: input.parentAgent,
      },
    }

    this.taskStartTimes.set(taskId, Date.now())
    this.logEvent(event)
  }

  /**
   * Log when resume prompt is sent
   */
  logResumePromptSent(task: BackgroundTask, promptLength: number): void {
    const startTime = this.taskStartTimes.get(task.id)
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "resume_prompt_sent",
      taskId: task.id,
      sessionId: task.sessionID,
      agent: task.agent,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
      details: {
        promptLength,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log successful resume
   */
  logResumeComplete(task: BackgroundTask): void {
    const startTime = this.taskStartTimes.get(task.id)
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "resume_complete",
      taskId: task.id,
      sessionId: task.sessionID,
      agent: task.agent,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
      status: task.status,
    }
    this.logEvent(event)
  }

  /**
   * Log resume error
   */
  logResumeError(task: BackgroundTask, error: unknown): void {
    const startTime = this.taskStartTimes.get(task.id)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "resume_error",
      taskId: task.id,
      sessionId: task.sessionID,
      error: errorMessage,
      errorStack,
      elapsedMs: startTime ? Date.now() - startTime : undefined,
    }
    this.logEvent(event)
  }

  // ===============================================
  // SESSION LIFECYCLE TRACKING
  // ===============================================

  /**
   * Log session.idle event received
   */
  logSessionIdle(
    taskId: string,
    sessionId: string,
    elapsedMs: number,
    ignored: boolean,
    reason?: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "session_idle",
      taskId,
      sessionId,
      elapsedMs,
      details: {
        ignored,
        reason,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log session completed
   */
  logSessionCompleted(
    task: BackgroundTask,
    source: "event" | "polling" | "stability"
  ): void {
    const duration = task.completedAt
      ? task.completedAt.getTime() - task.startedAt.getTime()
      : undefined

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "session_completed",
      taskId: task.id,
      sessionId: task.sessionID,
      agent: task.agent,
      model: task.model,
      duration,
      status: task.status,
      details: {
        source,
        toolCalls: task.progress?.toolCalls,
        lastTool: task.progress?.lastTool,
      },
    }
    this.logEvent(event)

    this.taskStartTimes.delete(task.id)
  }

  /**
   * Log session deleted
   */
  logSessionDeleted(task: BackgroundTask): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "session_deleted",
      taskId: task.id,
      sessionId: task.sessionID,
      status: task.status,
      error: task.error,
    }
    this.logEvent(event)
  }

  /**
   * Log session error
   */
  logSessionError(
    task: BackgroundTask,
    error: unknown,
    phase: string
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    const duration = task.completedAt
      ? task.completedAt.getTime() - task.startedAt.getTime()
      : Date.now() - task.startedAt.getTime()

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "session_error",
      taskId: task.id,
      sessionId: task.sessionID,
      agent: task.agent,
      duration,
      error: errorMessage,
      errorStack,
      details: {
        phase,
        toolCalls: task.progress?.toolCalls,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // EVENT HANDLING
  // ===============================================

  /**
   * Log raw event received from OpenCode
   */
  logEventReceived(
    eventType: string,
    sessionId: string | undefined,
    taskId: string | undefined,
    details?: Record<string, unknown>
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "event_received",
      taskId,
      sessionId,
      details: {
        eventType,
        ...details,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // POLLING & STABILITY
  // ===============================================

  /**
   * Log polling tick
   */
  logPollingTick(
    taskId: string,
    sessionId: string,
    sessionStatus: string | undefined,
    elapsedMs: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "polling_tick",
      taskId,
      sessionId,
      elapsedMs,
      details: {
        sessionStatus,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log polling status result
   */
  logPollingStatus(
    taskId: string,
    messageCount: number,
    toolCalls: number,
    lastTool: string | undefined,
    stablePolls: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "polling_status",
      taskId,
      details: {
        messageCount,
        toolCalls,
        lastTool,
        stablePolls,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log stability check
   */
  logStabilityCheck(
    taskId: string,
    stablePolls: number,
    hasValidOutput: boolean,
    hasIncompleteTodos: boolean
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "stability_check",
      taskId,
      details: {
        stablePolls,
        hasValidOutput,
        hasIncompleteTodos,
        threshold: 3,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log stability-based completion
   */
  logStabilityComplete(taskId: string, reason: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "stability_complete",
      taskId,
      details: {
        reason,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // TODO & OUTPUT VALIDATION
  // ===============================================

  /**
   * Log todo check result
   */
  logTodoCheck(
    taskId: string,
    hasIncompleteTodos: boolean,
    todoCount?: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "todo_check",
      taskId,
      details: {
        hasIncompleteTodos,
        todoCount,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log output validation result
   */
  logOutputValidation(
    taskId: string,
    sessionId: string,
    hasValidOutput: boolean,
    messageCount?: number,
    hasContent?: boolean
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "output_validation",
      taskId,
      sessionId,
      details: {
        hasValidOutput,
        messageCount,
        hasContent,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // NOTIFICATIONS
  // ===============================================

  /**
   * Log notification sent to parent
   */
  logNotificationSent(
    task: BackgroundTask,
    allComplete: boolean,
    noReply: boolean,
    resolvedAgent: string | undefined,
    resolvedModel: { providerID: string; modelID: string } | undefined
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "notification_sent",
      taskId: task.id,
      sessionId: task.sessionID,
      parentSessionId: task.parentSessionID,
      details: {
        allComplete,
        noReply,
        resolvedAgent,
        resolvedModel,
        status: task.status,
        error: task.error,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // HANGING / TIMEOUT DETECTION
  // ===============================================

  /**
   * Log timeout warning
   */
  logTimeoutWarning(
    taskId: string,
    sessionId: string,
    elapsedMs: number,
    timeoutMs: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "timeout_warning",
      taskId,
      sessionId,
      elapsedMs,
      details: {
        timeoutMs,
        percentOfTimeout: Math.round((elapsedMs / timeoutMs) * 100),
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // CONCURRENCY
  // ===============================================

  /**
   * Log concurrency acquired
   */
  logConcurrencyAcquired(taskId: string, key: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "concurrency_acquired",
      taskId,
      details: {
        concurrencyKey: key,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log concurrency released
   */
  logConcurrencyReleased(taskId: string, key: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "concurrency_released",
      taskId,
      details: {
        concurrencyKey: key,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // AUTH
  // ===============================================

  /**
   * Log authentication status
   */
  logAuthStatus(
    hasPassword: boolean,
    username: string,
    serverUrl: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "auth_status",
      details: {
        hasPassword,
        username,
        serverUrl: serverUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"), // Redact credentials
      },
    }
    this.logEvent(event)
  }

  /**
   * Log client created
   */
  logClientCreated(serverUrl: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "client_created",
      details: {
        serverUrl: serverUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"), // Redact credentials
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // MODEL RESOLUTION TRACKING
  // ===============================================

  /**
   * Log model resolution - tracks which model is actually used (including config overrides)
   */
  logModelResolved(
    taskId: string | undefined,
    agent: string,
    resolvedModel: string,
    source: "user-defined" | "inherited" | "default" | "agent-config" | "category",
    category?: string,
    originalModel?: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "model_resolved",
      taskId,
      agent,
      details: {
        resolvedModel,
        source,
        category,
        originalModel,
        wasOverridden: originalModel !== undefined && originalModel !== resolvedModel,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // MEMORY LEAK TRACKING (PR #715, #736)
  // ===============================================

  /**
   * Log memory snapshot - tracks internal data structure sizes
   */
  logMemorySnapshot(
    taskMapSize: number,
    notificationsMapSize: number,
    pendingByParentSize: number,
    taskStartTimesSize: number,
    bufferSize: number,
    runningTaskCount: number,
    orphanedTaskCount: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "memory_snapshot",
      details: {
        taskMapSize,
        notificationsMapSize,
        pendingByParentSize,
        taskStartTimesSize,
        eventBufferSize: bufferSize,
        runningTaskCount,
        orphanedTaskCount,
        potentialLeak: taskMapSize > 100 || orphanedTaskCount > 10,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log memory leak warning when thresholds exceeded
   */
  logMemoryLeakWarning(
    reason: string,
    taskMapSize: number,
    orphanedTaskIds?: string[]
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "memory_leak_warning",
      error: reason,
      details: {
        taskMapSize,
        orphanedTaskIds,
        threshold: 100,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log task pruned (timeout/cleanup)
   */
  logTaskPruned(
    taskId: string,
    sessionId: string,
    reason: string,
    ageMs: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "task_pruned",
      taskId,
      sessionId,
      details: {
        reason,
        ageMs,
        ageMinutes: Math.round(ageMs / 60000),
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // RESUME TIMING (PR #736)
  // ===============================================

  /**
   * Log startedAt reset on resume (prevents false completion)
   */
  logResumeTimingReset(
    taskId: string,
    sessionId: string,
    oldStartedAt: Date,
    newStartedAt: Date
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "resume_timing_reset",
      taskId,
      sessionId,
      details: {
        oldStartedAt: oldStartedAt.toISOString(),
        newStartedAt: newStartedAt.toISOString(),
        elapsedBeforeReset: Date.now() - oldStartedAt.getTime(),
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // PENDING PARENT TRACKING (PR #736)
  // ===============================================

  /**
   * Log pendingByParent update
   */
  logPendingParentUpdate(
    parentSessionId: string,
    taskId: string,
    action: "add" | "remove",
    remainingCount: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "pending_parent_update",
      taskId,
      parentSessionId,
      details: {
        action,
        remainingCount,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log pendingByParent cleanup
   */
  logPendingParentCleanup(
    parentSessionId: string,
    cleanedTaskId: string,
    source: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "pending_parent_cleanup",
      taskId: cleanedTaskId,
      parentSessionId,
      details: {
        source,
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // CONCURRENCY DOUBLE-RELEASE PREVENTION (PR #736)
  // ===============================================

  /**
   * Log when double-release was prevented
   */
  logDoubleReleasePrevented(taskId: string, key: string): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "concurrency_double_release_prevented",
      taskId,
      details: {
        concurrencyKey: key,
        message: "Key was already undefined, prevented double-release",
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // IDLE DETECTION (PR #715)
  // ===============================================

  /**
   * Log session.idle ignored (too early)
   */
  logSessionIdleIgnored(
    taskId: string,
    sessionId: string,
    elapsedMs: number,
    minIdleTimeMs: number,
    reason: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "session_idle_ignored",
      taskId,
      sessionId,
      elapsedMs,
      details: {
        minIdleTimeMs,
        reason,
        percentOfMinIdle: Math.round((elapsedMs / minIdleTimeMs) * 100),
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // GLOBAL TIMEOUT (PR #715)
  // ===============================================

  /**
   * Log global timeout triggered
   */
  logGlobalTimeout(
    taskId: string,
    sessionId: string,
    elapsedMs: number,
    maxRunTimeMs: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "global_timeout",
      taskId,
      sessionId,
      elapsedMs,
      details: {
        maxRunTimeMs,
        elapsedMinutes: Math.round(elapsedMs / 60000),
        maxMinutes: Math.round(maxRunTimeMs / 60000),
      },
    }
    this.logEvent(event)
  }

  /**
   * Log session timeout (30 min TTL)
   */
  logSessionTimeout(
    taskId: string,
    sessionId: string,
    ageMs: number,
    ttlMs: number
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "session_timeout",
      taskId,
      sessionId,
      details: {
        ageMs,
        ageMinutes: Math.round(ageMs / 60000),
        ttlMinutes: Math.round(ttlMs / 60000),
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // HTTP REQUEST TRACKING
  // ===============================================

  /**
   * Log HTTP request (for debugging auth issues)
   */
  logHttpRequest(
    method: string,
    url: string,
    hasAuthHeader: boolean,
    taskId?: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "http_request",
      taskId,
      details: {
        method,
        url: url.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"), // Redact credentials
        hasAuthHeader,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log HTTP response
   */
  logHttpResponse(
    method: string,
    url: string,
    status: number,
    durationMs: number,
    taskId?: string
  ): void {
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "http_response",
      taskId,
      details: {
        method,
        url: url.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
        status,
        durationMs,
        success: status >= 200 && status < 300,
      },
    }
    this.logEvent(event)
  }

  /**
   * Log HTTP error
   */
  logHttpError(
    method: string,
    url: string,
    error: unknown,
    taskId?: string
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type: "http_error",
      taskId,
      error: errorMessage,
      errorStack,
      details: {
        method,
        url: url.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
      },
    }
    this.logEvent(event)
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  /**
   * Get all recent events from buffer
   */
  getRecentEvents(): DebugEvent[] {
    return this.eventBuffer.getAll()
  }

  /**
   * Get events for a specific task
   */
  getTaskEvents(taskId: string): DebugEvent[] {
    return this.eventBuffer.getAll().filter((e) => e.taskId === taskId)
  }

  /**
   * Get events for a specific session
   */
  getSessionEvents(sessionId: string): DebugEvent[] {
    return this.eventBuffer.getAll().filter((e) => e.sessionId === sessionId)
  }

  /**
   * Clear event buffer
   */
  clearBuffer(): void {
    this.eventBuffer.clear()
    this.taskStartTimes.clear()
  }

  /**
   * Get debug log file path
   */
  getLogFilePath(): string {
    return DEBUG_LOG_FILE
  }

  /**
   * Check if debug logging is enabled
   */
  isEnabled(): boolean {
    return DEBUG_ENABLED
  }

  /**
   * Generate summary for a task
   */
  getTaskSummary(taskId: string): {
    events: number
    duration?: number
    status?: string
    errors: string[]
  } {
    const events = this.getTaskEvents(taskId)
    const errors = events
      .filter((e) => e.error)
      .map((e) => e.error as string)

    const lastEvent = events[events.length - 1]
    const startEvent = events.find(
      (e) => e.type === "spawn_start" || e.type === "resume_start"
    )
    const endEvent = events.find(
      (e) =>
        e.type === "session_completed" ||
        e.type === "session_error" ||
        e.type === "spawn_error"
    )

    let duration: number | undefined
    if (startEvent && endEvent) {
      const startTime = new Date(startEvent.timestamp).getTime()
      const endTime = new Date(endEvent.timestamp).getTime()
      duration = endTime - startTime
    }

    return {
      events: events.length,
      duration,
      status: lastEvent?.status,
      errors,
    }
  }
}

// Export singleton instance
export const debugLogger = BackgroundAgentDebugLogger.getInstance()

// Convenience exports for direct function access
export const logSpawnStart = debugLogger.logSpawnStart.bind(debugLogger)
export const logSessionCreated = debugLogger.logSessionCreated.bind(debugLogger)
export const logPromptSent = debugLogger.logPromptSent.bind(debugLogger)
export const logSpawnComplete = debugLogger.logSpawnComplete.bind(debugLogger)
export const logSpawnError = debugLogger.logSpawnError.bind(debugLogger)
export const logResumeStart = debugLogger.logResumeStart.bind(debugLogger)
export const logResumePromptSent = debugLogger.logResumePromptSent.bind(debugLogger)
export const logResumeComplete = debugLogger.logResumeComplete.bind(debugLogger)
export const logResumeError = debugLogger.logResumeError.bind(debugLogger)
export const logResumeTimingReset = debugLogger.logResumeTimingReset.bind(debugLogger)
export const logSessionIdle = debugLogger.logSessionIdle.bind(debugLogger)
export const logSessionIdleIgnored = debugLogger.logSessionIdleIgnored.bind(debugLogger)
export const logSessionCompleted = debugLogger.logSessionCompleted.bind(debugLogger)
export const logSessionDeleted = debugLogger.logSessionDeleted.bind(debugLogger)
export const logSessionError = debugLogger.logSessionError.bind(debugLogger)
export const logSessionTimeout = debugLogger.logSessionTimeout.bind(debugLogger)
export const logGlobalTimeout = debugLogger.logGlobalTimeout.bind(debugLogger)
export const logEventReceived = debugLogger.logEventReceived.bind(debugLogger)
export const logPollingTick = debugLogger.logPollingTick.bind(debugLogger)
export const logPollingStatus = debugLogger.logPollingStatus.bind(debugLogger)
export const logStabilityCheck = debugLogger.logStabilityCheck.bind(debugLogger)
export const logStabilityComplete = debugLogger.logStabilityComplete.bind(debugLogger)
export const logTodoCheck = debugLogger.logTodoCheck.bind(debugLogger)
export const logOutputValidation = debugLogger.logOutputValidation.bind(debugLogger)
export const logNotificationSent = debugLogger.logNotificationSent.bind(debugLogger)
export const logTimeoutWarning = debugLogger.logTimeoutWarning.bind(debugLogger)
export const logConcurrencyAcquired = debugLogger.logConcurrencyAcquired.bind(debugLogger)
export const logConcurrencyReleased = debugLogger.logConcurrencyReleased.bind(debugLogger)
export const logDoubleReleasePrevented = debugLogger.logDoubleReleasePrevented.bind(debugLogger)
export const logPendingParentUpdate = debugLogger.logPendingParentUpdate.bind(debugLogger)
export const logPendingParentCleanup = debugLogger.logPendingParentCleanup.bind(debugLogger)
export const logMemorySnapshot = debugLogger.logMemorySnapshot.bind(debugLogger)
export const logMemoryLeakWarning = debugLogger.logMemoryLeakWarning.bind(debugLogger)
export const logTaskPruned = debugLogger.logTaskPruned.bind(debugLogger)
export const logAuthStatus = debugLogger.logAuthStatus.bind(debugLogger)
export const logClientCreated = debugLogger.logClientCreated.bind(debugLogger)
export const logHttpRequest = debugLogger.logHttpRequest.bind(debugLogger)
export const logHttpResponse = debugLogger.logHttpResponse.bind(debugLogger)
export const logHttpError = debugLogger.logHttpError.bind(debugLogger)
export const logModelResolved = debugLogger.logModelResolved.bind(debugLogger)
export const getDebugLogFilePath = debugLogger.getLogFilePath.bind(debugLogger)
export const isDebugEnabled = debugLogger.isEnabled.bind(debugLogger)
