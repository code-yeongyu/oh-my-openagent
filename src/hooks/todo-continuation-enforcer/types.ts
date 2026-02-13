import type { BackgroundManager } from "../../features/background-agent"
import type { ToolPermission } from "../../features/hook-message-injector"

export interface TodoContinuationEnforcerOptions {
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
}

export interface TodoContinuationEnforcer {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cancelAllCountdowns: () => void
}

export interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

export interface SessionState {
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
  countdownStartedAt?: number
  abortDetectedAt?: number
  lastInjectedAt?: number
  inFlight?: boolean
  lastTodoHash?: string
  unchangedCycles?: number
}

export interface MessageInfo {
  id?: string
  role?: string
  error?: { name?: string; data?: unknown }
  agent?: string
  model?: { providerID: string; modelID: string }
  providerID?: string
  modelID?: string
  tools?: Record<string, ToolPermission>
}

export interface ResolvedMessageInfo {
  agent?: string
  model?: { providerID: string; modelID: string }
  tools?: Record<string, ToolPermission>
}
