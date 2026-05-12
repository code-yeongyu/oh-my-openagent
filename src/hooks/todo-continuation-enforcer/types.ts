import type { BackgroundManager } from "../../features/background-agent"
import type { ToolPermission } from "../../features/hook-message-injector"

export interface ContinuationTimingConfig {
  /** Base cooldown between continuation injections in ms (default: 5000) */
  cooldownMs?: number
  /** Grace period after abort detection in ms (default: 3000) */
  abortWindowMs?: number
  /** Max consecutive injections without todo progress before stopping (default: 3) */
  maxStagnationCount?: number
  /** Max injection failures before entering pause period (default: 5) */
  maxConsecutiveFailures?: number
  /** Window in ms before consecutive failure count resets (default: 300000) */
  failureResetWindowMs?: number
  /** Countdown toast duration in seconds (default: 2) */
  countdownSeconds?: number
}

export interface TodoContinuationEnforcerOptions {
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
  continuationConfig?: ContinuationTimingConfig
}

export interface TodoContinuationEnforcer {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cancelAllCountdowns: () => void
  dispose: () => void
}

export interface Todo {
  content: string;
  status: string;
  priority: string;
  id?: string;
}

export interface SessionState {
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
  wasCancelled?: boolean
  tokenLimitDetected?: boolean
  countdownStartedAt?: number
  abortDetectedAt?: number
  lastIncompleteCount?: number
  lastInjectedAt?: number
  awaitingPostInjectionProgressCheck?: boolean
  inFlight?: boolean
  stagnationCount: number
  consecutiveFailures: number
  recentCompactionAt?: number
  recentCompactionEpoch?: number
  acknowledgedCompactionEpoch?: number
}

export interface MessageInfo {
  id?: string
  role?: string
  error?: { name?: string; data?: unknown }
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  providerID?: string
  modelID?: string
  tools?: Record<string, ToolPermission>
}

export interface MessageWithInfo {
  info?: MessageInfo
  parts?: Array<{ type?: string }>
}

export interface ResolvedMessageInfo {
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  tools?: Record<string, ToolPermission>
}

export interface ResolveLatestMessageInfoResult {
  resolvedInfo?: ResolvedMessageInfo
  encounteredCompaction: boolean
  latestMessageWasCompaction: boolean
}

export interface ContinuationProgressOptions {
  allowActivityProgress?: boolean
}
