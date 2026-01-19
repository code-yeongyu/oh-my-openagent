/**
 * Boulder State Types
 *
 * Manages the active work plan state for Sisyphus orchestrator.
 * Named after Sisyphus's boulder - the eternal task that must be rolled.
 */

/**
 * Phase status for workflow state machine (Task 9.1)
 */
export type PhaseStatus = "idle" | "planning" | "reviewing" | "executing" | "awaiting_user" | "completed" | "failed"

/**
 * Worktree status for Wave execution (Task 10.3)
 */
export type WorktreeStatus = "pending" | "ready" | "in_progress" | "completed" | "failed" | "cleaned"

/**
 * Wave worktree tracking information (Task 10.3)
 */
export interface WaveWorktree {
  /** Wave ID (0, 1, 2, ...) */
  waveId: number
  /** Git branch name for this wave */
  branch: string
  /** Absolute path to the worktree directory */
  path: string
  /** Current status of this worktree */
  status: WorktreeStatus
  /** Task IDs assigned to this wave */
  taskIds: string[]
  /** Commit SHAs for completed tasks */
  completedShas?: Record<string, string>
  /** Error message if failed */
  error?: string
  /** ISO timestamp when created */
  createdAt?: string
  /** ISO timestamp when last updated */
  updatedAt?: string
}

/**
 * Wave execution state (Task 10.3)
 */
export interface WaveExecutionState {
  /** Feature name for this execution */
  featureName: string
  /** Execution mode: parallel (multiple worktrees) or sequential (single worktree) */
  mode: "parallel" | "sequential"
  /** Base directory for worktrees (e.g., .worktrees/) */
  worktreeBaseDir: string
  /** All wave worktrees */
  waves: WaveWorktree[]
  /** ISO timestamp when execution started */
  startedAt: string
  /** ISO timestamp when execution completed */
  completedAt?: string
}

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
  /** ISO timestamp when work completed (Phase 3 finished) */
  completed_at?: string
  /** Wave execution state for parallel/sequential mode (Task 10.3) */
  wave_execution?: WaveExecutionState

  // === Fields migrated from .superpowers/status.json ===
  /** Current change name (e.g., feature being worked on) */
  currentChange?: string
  /** Path to the proposal.md file */
  proposal_path?: string
  /** Path to the design.md file */
  design_path?: string
  /** Path to the tasks.md file */
  tasks_path?: string
  /** Execution mode: sequential or parallel */
  execution_mode?: "sequential" | "parallel"
  /** ISO timestamp when work was archived */
  archived_at?: string
  /** Path to the archive directory */
  archive_path?: string
}

export interface PlanProgress {
  /** Total number of checkboxes */
  total: number
  /** Number of completed checkboxes */
  completed: number
  /** Whether all tasks are done */
  isComplete: boolean
}
