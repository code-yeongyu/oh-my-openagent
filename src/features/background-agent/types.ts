import type { FallbackEntry } from "../../shared/model-requirements"
import type { DelegatedModelConfig, ModelIntent } from "../../shared/model-resolution-types"
import type { SessionPermissionRule } from "../../shared/question-denied-session-permission"

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "interrupt"

export interface ToolCallWindow {
  lastSignature: string
  consecutiveCount: number
  threshold: number
}

export interface TaskProgress {
  toolCalls: number
  lastTool?: string
  toolCallWindow?: ToolCallWindow
  countedToolPartIDs?: Set<string>
  lastUpdate: Date
  lastMessage?: string
  lastMessageAt?: Date
}

export type BackgroundTaskAttemptStatus = BackgroundTaskStatus

export interface BackgroundTaskAttempt {
  attemptId: string
  attemptNumber: number
  sessionId?: string
  providerId?: string
  modelId?: string
  variant?: string
  status: BackgroundTaskAttemptStatus
  error?: string
  startedAt?: Date
  completedAt?: Date
}

export interface BackgroundTask {
  id: string
  sessionId?: string
  rootSessionId?: string
  parentSessionId: string
  parentMessageId: string
  teamRunId?: string
  description: string
  prompt: string
  agent: string
  spawnDepth?: number
  status: BackgroundTaskStatus
  queuedAt?: Date
  startedAt?: Date
  completedAt?: Date
  result?: string
  error?: string
  progress?: TaskProgress
  parentModel?: { providerID: string; modelID: string }
  model?: DelegatedModelConfig
  /** Fallback chain for runtime retry on model errors */
  fallbackChain?: FallbackEntry[]
  /**
   * Sticky-model intent. "explicit" = user named this model, retry handler
   * MUST NOT advance the chain on transient errors. "auto" = system-resolved,
   * chain advancement permitted. Undefined = legacy task, treated as "auto".
   */
  modelIntent?: ModelIntent
  /**
   * Provider IDs that have already returned a `isProviderScopedStop` error
   * during this task's lifetime (insufficient balance, quota exceeded, etc).
   * The sticky cross-provider escape excludes these from candidate alternate
   * providers, preventing ping-pong (e.g. opencode-go fails -> escape to
   * github-copilot -> github-copilot fails -> escape would otherwise
   * re-pick opencode-go which is still broken). Lower-cased for stable
   * comparison.
   */
  failedProviders?: string[]
  /** Number of fallback retry attempts made */
  attemptCount?: number
  /** Active concurrency slot key */
  concurrencyKey?: string
  /** Persistent key for re-acquiring concurrency on resume */
  concurrencyGroup?: string
  /** Parent session's agent name for notification */
  parentAgent?: string
  /** Parent session's tool restrictions for notification prompts */
  parentTools?: Record<string, boolean>
  /** Marks if the task was launched from an unstable agent/category */
  isUnstableAgent?: boolean
  /** Category used for this task (e.g., 'quick', 'visual-engineering') */
  category?: string
  /** Pending retry notification details for the next spawned retry session */
  retryNotification?: {
    previousSessionID?: string
    failedModel?: string
    failedError?: string
    nextModel: string
  }

  /** Structured attempt history for retry observability */
  attempts?: BackgroundTaskAttempt[]
  /** ID of the currently active attempt */
  currentAttemptID?: string

  /** Last message count for stability detection */
  lastMsgCount?: number
  /** Number of consecutive polls with stable message count */
  stablePolls?: number
  /** Number of consecutive polls where session was missing from status map */
  consecutiveMissedPolls?: number
}

export interface LaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionId: string
  parentMessageId: string
  teamRunId?: string
  suppressTmuxSpawn?: boolean
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  parentTools?: Record<string, boolean>
  model?: DelegatedModelConfig
  /** Fallback chain for runtime retry on model errors */
  fallbackChain?: FallbackEntry[]
  /**
   * Sticky-model intent for the launched task. Sets the gate that
   * `tryFallbackRetry` consults: "explicit" refuses chain advancement.
   * Undefined preserves legacy auto behavior.
   */
  modelIntent?: ModelIntent
  isUnstableAgent?: boolean
  skills?: string[]
  skillContent?: string
  category?: string
  sessionPermission?: SessionPermissionRule[]
  onSessionCreated?: (sessionId: string) => void | Promise<void>
}

export interface ResumeInput {
  sessionId: string
  prompt: string
  parentSessionId: string
  parentMessageId: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  parentTools?: Record<string, boolean>
}
