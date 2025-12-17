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

/**
 * Default team for Linear issues
 */
export const DEFAULT_LINEAR_TEAM = "Lifelogger"

/**
 * Default team prefix for issue identifiers
 */
export const DEFAULT_TEAM_PREFIX = "LIF"
