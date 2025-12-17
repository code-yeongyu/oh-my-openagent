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
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
}

/**
 * Linear issue status options
 */
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
