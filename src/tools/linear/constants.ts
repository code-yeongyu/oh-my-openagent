/**
 * Description for linear_branch tool
 */
export const LINEAR_BRANCH_DESCRIPTION = `Get the git branch name for a Linear issue.

This tool fetches the branch name associated with a Linear issue, which ensures consistent branch naming across the team.

Returns:
- branchName: The branch name from Linear (e.g., "eru/lif-123-implement-feature")
- issueTitle: The issue title
- issueUrl: Link to the issue
- issueIdentifier: The issue ID (e.g., "LIF-123")

If Linear is unavailable, generates a fallback branch name.`

/**
 * Description for linear_update_status tool
 */
export const LINEAR_UPDATE_STATUS_DESCRIPTION = `Update the status of a Linear issue with an optional comment.

Use this to:
- Mark an issue as "in_progress" when starting work
- Mark as "in_review" when submitting for review
- Mark as "done" when completing work
- Add progress comments to track work

Status options: todo, in_progress, in_review, done, canceled`

/**
 * Description for linear_create_issue tool
 */
export const LINEAR_CREATE_ISSUE_DESCRIPTION = `Create a new Linear issue.

Use this to create tracking issues for:
- New features
- Bug fixes
- Technical debt
- Documentation tasks

Returns the created issue ID and URL.`

export const LINEAR_ARCHIVE_ISSUE_DESCRIPTION = `Archive a Linear issue.

Use this to archive issues that are no longer needed, test issues, or duplicates.
Archived issues can be restored from Linear's UI if needed.`

export const LINEAR_GET_ISSUE_DESCRIPTION = `Get details of a Linear issue.

Returns issue title, description, status, labels, and URL.
Use this to read issue context before starting work.`

export const LINEAR_ADD_COMMENT_DESCRIPTION = `Add a comment to a Linear issue.

Use this to post progress updates, decisions, or blockers to an issue.`

export const DEFAULT_LINEAR_TEAM = "Lifelogger"

/**
 * Default team prefix for issue identifiers
 */
export const DEFAULT_TEAM_PREFIX = "LIF"

/**
 * Map string priority names to numeric values for Linear API
 */
export const PRIORITY_MAP: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

/**
 * Map numeric priority to human-readable labels
 */
export const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
}

/**
 * Description for linear_update_issue tool
 */
export const LINEAR_UPDATE_ISSUE_DESCRIPTION = `Comprehensively update a Linear issue's fields.

Use this to update any combination of:
- title: New issue title
- description: New description (Markdown supported)
- priority: 0-4 or "urgent"/"high"/"medium"/"low"/"none"
- estimate: Story point estimate (number)
- dueDate: "YYYY-MM-DD" or null to clear
- assigneeId: User UUID or null to unassign
- labels: { add?: [...], remove?: [...], set?: [...] } (mutually exclusive)

Only provided fields are modified (partial update semantics).

Returns:
- changes: Array of { field, from, to } showing what changed
- currentState: Full issue state after update
- message: Human-readable summary

Note: For status changes, use linear_update_status instead.`
