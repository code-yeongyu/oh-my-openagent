/**
 * Failure Counter Hook Types
 *
 * Tracks consecutive failures for delegate_task calls and triggers
 * automatic responses at each failure threshold.
 */

export interface FailureRecord {
  taskId: string
  timestamp: number
  errorMessage?: string
}

export interface FailureTracker {
  taskId: string
  consecutiveFailures: number
  lastError?: string
  lastFailureTimestamp?: number
}

export interface FailureCounterConfig {
  /** Enable the failure counter hook (default: true) */
  enabled: boolean
  /** Time window in ms to consider failures as consecutive (default: 5 minutes) */
  failure_window_ms: number
  /** Reset failure count on success (default: true) */
  reset_on_success: boolean
  /** First failure threshold - inject systematic-debugging skill (default: 1) */
  threshold_skill_injection: number
  /** Second failure threshold - dispatch Oracle for consultation (default: 2) */
  threshold_oracle_dispatch: number
  /** Third failure threshold - block delegate_task and require user intervention (default: 3) */
  threshold_block: number
}

export interface FailureCounterState {
  /** Map of task context (e.g., session ID) to failure tracker */
  trackers: Map<string, FailureTracker>
  /** Sessions where skill has been injected */
  skillInjectedSessions: Set<string>
  /** Sessions where Oracle has been dispatched */
  oracleDispatchedSessions: Set<string>
  /** Sessions that are blocked */
  blockedSessions: Set<string>
}

export type FailureResponse =
  | { type: "inject_skill"; skillName: string; message: string }
  | { type: "dispatch_oracle"; message: string }
  | { type: "block"; message: string }
  | { type: "none" }
