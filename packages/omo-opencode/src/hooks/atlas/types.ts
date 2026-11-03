import type { AgentOverrides } from "../../config"
import type { TopLevelTaskRef } from "../../features/boulder-state"

export type ModelInfo = { providerID: string; modelID: string; variant?: string }

export interface BackgroundTaskStatusProvider {
  getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
}

export interface AtlasHookOptions {
  directory: string
  backgroundManager?: BackgroundTaskStatusProvider
  isContinuationStopped?: (sessionID: string) => boolean
  isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>
  agentOverrides?: AgentOverrides
  idleSettleMs?: number
  /** Enable auto-commit after each atomic task completion (default: true) */
  autoCommit?: boolean
  /** Schedules the delayed continuation retry (default: the global setTimeout) */
  retryScheduler?: AtlasRetryScheduler
}

/** A scheduled delayed continuation retry; cancel() drops it before it fires. */
export interface AtlasRetryTimer {
  cancel: () => void
}

/** Schedules the hook's delayed continuation retry, so tests can drive it without patching global timers. */
export type AtlasRetryScheduler = (callback: () => Promise<void>, delayMs: number) => AtlasRetryTimer

export interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

export interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

export type TrackedTopLevelTaskRef = Pick<TopLevelTaskRef, "key" | "label" | "title">

export type PendingTaskRef =
  | { kind: "track"; task: TrackedTopLevelTaskRef }
  | { kind: "skip"; reason: "explicit_resume" }
  | { kind: "skip"; reason: "ambiguous_task_key"; task: TrackedTopLevelTaskRef }

export interface SessionState {
  lifecycleActive?: boolean
  lastEventWasAbortError?: boolean
  skipNextIdleAfterRuntimeErrorRetry?: boolean
  lastContinuationInjectedAt?: number
  isInjectingContinuation?: boolean
  promptFailureCount: number
  lastFailureAt?: number
  pendingRetryTimer?: AtlasRetryTimer
  waitingForFinalWaveApproval?: boolean
  pendingFinalWaveTaskCount?: number
  approvedFinalWaveTaskCount?: number
  boulderCompletionNudgedAt?: Record<string, number>
  awaitingToolProgressAfterContinuation?: boolean
  iterationsSinceLastToolProgress?: number
  lastToolProgressAt?: number
  stalledContinuationReason?: string
  stalledContinuationPlanPath?: string
  /** The plan path the in-progress no-tool-progress counter is keyed to. Changes here reset the counter. */
  activeContinuationPlanPath?: string
  /** Top-level task keys whose completion gate already fired, used to suppress repeat 4-phase reminders. */
  verifiedTaskKeys?: Set<string>
}
