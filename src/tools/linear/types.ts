/**
 * Result from linear_branch tool
 */
export interface LinearBranchResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The branch name from Linear or generated fallback */
  branchName: string
  /** Whether the branch name was generated (true) or from Linear (false) */
  generated: boolean
  /** The issue title */
  issueTitle: string
  /** The issue URL */
  issueUrl: string
  /** The issue identifier (e.g., LIF-123) */
  issueIdentifier: string
  /** Error message if failed */
  error?: string
}

/**
 * Result from linear_update_status tool
 */
export interface LinearUpdateStatusResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The issue ID that was updated */
  issueId: string
  /** The new status */
  newStatus: string
  /** Whether a comment was added */
  commentAdded: boolean
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
}

/**
 * Result from linear_create_issue tool
 */
export interface LinearCreateIssueResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The created issue ID */
  issueId?: string
  /** The created issue identifier (e.g., LIF-123) */
  issueIdentifier?: string
  /** The created issue URL */
  issueUrl?: string
  /** Parent issue identifier if created as sub-issue */
  parentIdentifier?: string
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
}

/**
 * Result from linear_archive_issue tool
 */
export interface LinearArchiveIssueResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The issue ID that was archived */
  issueId: string
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
}

export interface LinearGetIssueResult {
  success: boolean
  issue?: {
    id: string
    identifier: string
    title: string
    description?: string
    url: string
    status: string
    labels: string[]
  }
  message: string
  error?: string
}

export interface LinearAddCommentResult {
  success: boolean
  issueId: string
  message: string
  error?: string
}

export type LinearIssueStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "canceled"

/**
 * Mapping from our status names to Linear workflow state types
 */
export const STATUS_TO_STATE_TYPE: Record<LinearIssueStatus, string> = {
  todo: "unstarted",
  in_progress: "started",
  in_review: "started",
  done: "completed",
  canceled: "canceled",
}

/**
 * linear_update_issue Types (LIF-102)
 */

/**
 * Priority values - support both numeric and string formats
 * Numeric: 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low)
 * String: "urgent", "high", "medium", "low", "none"
 */
export type LinearPriority = 0 | 1 | 2 | 3 | 4 | "urgent" | "high" | "medium" | "low" | "none"

/**
 * Label operation modes - mutually exclusive
 * - add + remove can be combined
 * - set cannot be combined with add/remove
 */
export interface LinearLabelOperations {
  /** Add labels to existing labels */
  add?: string[]
  /** Remove labels from existing labels */
  remove?: string[]
  /** Replace all labels with this set (cannot be combined with add/remove) */
  set?: string[]
}

/**
 * Input for linear_update_issue tool
 * All fields are optional except issueId - only provided fields are updated
 */
export interface LinearUpdateIssueInput {
  /** Issue identifier (e.g., "LIF-123") or UUID */
  issueId: string
  /** New title */
  title?: string
  /** New description (Markdown supported) */
  description?: string
  /** Priority: 0-4 or "urgent"/"high"/"medium"/"low"/"none" */
  priority?: LinearPriority
  /** Story point estimate */
  estimate?: number
  /** Due date in YYYY-MM-DD format, or null to clear */
  dueDate?: string | null
  /** Assignee user ID (UUID), or null to unassign */
  assigneeId?: string | null
  /** Label operations - add, remove, or set (mutually exclusive) */
  labels?: LinearLabelOperations
}

/**
 * Single field change record for tracking what was modified
 */
export interface LinearFieldChange {
  /** Field name that was changed */
  field: string
  /** Previous value (null if not set) */
  from: unknown
  /** New value */
  to: unknown
}

/**
 * Current issue state after update
 */
export interface LinearIssueState {
  id: string
  identifier: string
  title: string
  description?: string
  priority: number
  priorityLabel: string
  estimate?: number
  dueDate?: string
  assignee?: {
    id: string
    name: string
    email: string
  }
  labels: string[]
  url: string
}

/**
 * Result from linear_update_issue tool
 */
export interface LinearUpdateIssueResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Issue identifier (e.g., "LIF-123") */
  issueIdentifier: string
  /** Issue URL */
  issueUrl: string
  /** Array of changes made */
  changes: LinearFieldChange[]
  /** Current issue state after update */
  currentState?: LinearIssueState
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
  /** Validation errors if input was invalid */
  validationErrors?: string[]
}
