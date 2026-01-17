/**
 * Boulder State Types
 *
 * Manages the active work plan state for Sisyphus orchestrator.
 * Named after Sisyphus's boulder - the eternal task that must be rolled.
 */

/**
 * Phase status for workflow state machine (Task 9.1)
 */
export type PhaseStatus = "idle" | "planning" | "reviewing" | "executing" | "completed" | "failed"

export interface BoulderState {
  /** Absolute path to the active plan file */
  active_plan: string
  /** ISO timestamp when work started */
  started_at: string
  /** Session IDs that have worked on this plan */
  session_ids: string[]
  /** Plan name derived from filename */
  plan_name: string
  /** Current phase status (Task 9.1) */
  phase?: PhaseStatus
  /** Current task being executed */
  current_task?: string
  /** Consecutive failure count for current task (Task 9.2) */
  failure_count?: number
  /** Last error message */
  last_error?: string
  /** Last updated timestamp */
  last_updated?: string
}

export interface PlanProgress {
  /** Total number of checkboxes */
  total: number
  /** Number of completed checkboxes */
  completed: number
  /** Whether all tasks are done */
  isComplete: boolean
}
