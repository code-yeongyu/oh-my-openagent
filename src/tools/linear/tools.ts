import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import {
  LINEAR_BRANCH_DESCRIPTION,
  LINEAR_UPDATE_STATUS_DESCRIPTION,
  LINEAR_CREATE_ISSUE_DESCRIPTION,
  LINEAR_ARCHIVE_ISSUE_DESCRIPTION,
  LINEAR_GET_ISSUE_DESCRIPTION,
  LINEAR_ADD_COMMENT_DESCRIPTION,
  DEFAULT_LINEAR_TEAM,
} from "./constants"
import type {
  LinearBranchResult,
  LinearUpdateStatusResult,
  LinearCreateIssueResult,
  LinearArchiveIssueResult,
  LinearGetIssueResult,
  LinearAddCommentResult,
  LinearIssueStatus,
} from "./types"
import { STATUS_TO_STATE_TYPE } from "./types"
import {
  getIssue,
  updateIssueState,
  createComment,
  createIssue,
  archiveIssue,
  isLinearAvailable,
} from "./api"

/**
 * Slugify a string for use in branch names
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
}

/**
 * Generate a fallback branch name when Linear is unavailable
 */
function generateFallbackBranch(issueId: string, title: string): string {
  const slug = slugify(title)
  return `feature/${issueId.toLowerCase()}-${slug}`
}

/**
 * Creates the linear_branch tool
 */
export function createLinearBranchTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_BRANCH_DESCRIPTION,
    args: {
      issueId: tool.schema
        .string()
        .describe("Linear issue ID (e.g., 'LIF-123' or full UUID)"),
    },
    async execute(args: { issueId: string }): Promise<string> {
      log(`[linear_branch] Getting branch for issue: ${args.issueId}`)

      // Check if Linear API is available
      if (!isLinearAvailable()) {
        const fallbackBranch = generateFallbackBranch(args.issueId, "feature")
        const result: LinearBranchResult = {
          success: true,
          branchName: fallbackBranch,
          generated: true,
          issueTitle: "Unknown (LINEAR_API_KEY not set)",
          issueUrl: `https://linear.app/issue/${args.issueId}`,
          issueIdentifier: args.issueId,
          error: "LINEAR_API_KEY environment variable not set",
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const issueResult = await getIssue(args.issueId)

        if (issueResult.error || !issueResult.issue) {
          log(`[linear_branch] API error:`, issueResult.error)
          const fallbackBranch = generateFallbackBranch(args.issueId, "feature")
          const result: LinearBranchResult = {
            success: true,
            branchName: fallbackBranch,
            generated: true,
            issueTitle: "Unknown (Linear unavailable)",
            issueUrl: `https://linear.app/issue/${args.issueId}`,
            issueIdentifier: args.issueId,
            error: issueResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        const issue = issueResult.issue
        const branchName =
          issue.branchName ||
          generateFallbackBranch(issue.identifier, issue.title)

        const result: LinearBranchResult = {
          success: true,
          branchName,
          generated: !issue.branchName,
          issueTitle: issue.title,
          issueUrl: issue.url,
          issueIdentifier: issue.identifier,
        }

        log(`[linear_branch] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_branch] Error:`, errorMessage)

        const fallbackBranch = generateFallbackBranch(args.issueId, "feature")
        const result: LinearBranchResult = {
          success: true,
          branchName: fallbackBranch,
          generated: true,
          issueTitle: "Unknown (Linear error)",
          issueUrl: `https://linear.app/issue/${args.issueId}`,
          issueIdentifier: args.issueId,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}

/**
 * Creates the linear_update_status tool
 */
export function createLinearUpdateStatusTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_UPDATE_STATUS_DESCRIPTION,
    args: {
      issueId: tool.schema.string().describe("Linear issue ID (e.g., 'LIF-123')"),
      status: tool.schema
        .enum(["todo", "in_progress", "in_review", "done", "canceled"] as const)
        .describe("New status for the issue"),
      comment: tool.schema
        .string()
        .describe("Optional comment to add with the status change")
        .optional(),
    },
    async execute(args: {
      issueId: string
      status: LinearIssueStatus
      comment?: string
    }): Promise<string> {
      log(`[linear_update_status] Updating ${args.issueId} to ${args.status}`)

      // Check if Linear API is available
      if (!isLinearAvailable()) {
        const result: LinearUpdateStatusResult = {
          success: false,
          issueId: args.issueId,
          newStatus: args.status,
          commentAdded: false,
          message: "LINEAR_API_KEY environment variable not set",
          error: "LINEAR_API_KEY not set",
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const stateType = STATUS_TO_STATE_TYPE[args.status]

        // Update the issue status
        const updateResult = await updateIssueState(args.issueId, stateType)

        if (!updateResult.success) {
          log(`[linear_update_status] Update error:`, updateResult.error)
          const result: LinearUpdateStatusResult = {
            success: false,
            issueId: args.issueId,
            newStatus: args.status,
            commentAdded: false,
            message: `Failed to update issue status`,
            error: updateResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        // Add comment if provided
        let commentAdded = false
        if (args.comment) {
          const commentResult = await createComment(args.issueId, args.comment)
          commentAdded = commentResult.success
          if (!commentResult.success) {
            log(`[linear_update_status] Comment error:`, commentResult.error)
          }
        }

        const result: LinearUpdateStatusResult = {
          success: true,
          issueId: args.issueId,
          newStatus: args.status,
          commentAdded,
          message: `Issue ${args.issueId} updated to '${args.status}'${
            commentAdded ? " with comment" : ""
          }`,
        }

        log(`[linear_update_status] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_update_status] Error:`, errorMessage)

        const result: LinearUpdateStatusResult = {
          success: false,
          issueId: args.issueId,
          newStatus: args.status,
          commentAdded: false,
          message: `Failed to update issue`,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}

/**
 * Creates the linear_create_issue tool
 */
export function createLinearCreateIssueTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_CREATE_ISSUE_DESCRIPTION,
    args: {
      title: tool.schema.string().describe("The issue title"),
      description: tool.schema
        .string()
        .describe("The issue description (Markdown supported)")
        .optional(),
      team: tool.schema
        .string()
        .describe(`Team name (default: ${DEFAULT_LINEAR_TEAM})`)
        .optional(),
      labels: tool.schema
        .array(tool.schema.string())
        .describe("Labels to apply to the issue")
        .optional(),
      parentId: tool.schema
        .string()
        .describe("Parent issue ID to create this as a sub-issue (e.g., 'LIF-123')")
        .optional(),
    },
    async execute(args: {
      title: string
      description?: string
      team?: string
      labels?: string[]
      parentId?: string
    }): Promise<string> {
      log(`[linear_create_issue] Creating issue: ${args.title}`)

      // Check if Linear API is available
      if (!isLinearAvailable()) {
        const result: LinearCreateIssueResult = {
          success: false,
          message: "LINEAR_API_KEY environment variable not set",
          error: "LINEAR_API_KEY not set",
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const createResult = await createIssue({
          title: args.title,
          description: args.description,
          teamName: args.team || DEFAULT_LINEAR_TEAM,
          labels: args.labels,
          parentId: args.parentId,
        })

        if (!createResult.success || !createResult.issue) {
          log(`[linear_create_issue] Create error:`, createResult.error)
          const result: LinearCreateIssueResult = {
            success: false,
            message: `Failed to create issue`,
            error: createResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        const issue = createResult.issue
        const isSubIssue = !!issue.parent
        const result: LinearCreateIssueResult = {
          success: true,
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          issueUrl: issue.url,
          parentIdentifier: issue.parent?.identifier,
          message: isSubIssue
            ? `Created sub-issue ${issue.identifier} under ${issue.parent?.identifier}: ${args.title}`
            : `Created issue ${issue.identifier}: ${args.title}`,
        }

        log(`[linear_create_issue] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_create_issue] Error:`, errorMessage)

        const result: LinearCreateIssueResult = {
          success: false,
          message: `Failed to create issue`,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}

export function createLinearArchiveIssueTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_ARCHIVE_ISSUE_DESCRIPTION,
    args: {
      issueId: tool.schema.string().describe("Linear issue ID (e.g., 'LIF-123')"),
    },
    async execute(args: { issueId: string }): Promise<string> {
      log(`[linear_archive_issue] Archiving issue: ${args.issueId}`)

      if (!isLinearAvailable()) {
        const result: LinearArchiveIssueResult = {
          success: false,
          issueId: args.issueId,
          message: "LINEAR_API_KEY environment variable not set",
          error: "LINEAR_API_KEY not set",
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const archiveResult = await archiveIssue(args.issueId)

        if (!archiveResult.success) {
          log(`[linear_archive_issue] Archive error:`, archiveResult.error)
          const result: LinearArchiveIssueResult = {
            success: false,
            issueId: args.issueId,
            message: `Failed to archive issue`,
            error: archiveResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        const result: LinearArchiveIssueResult = {
          success: true,
          issueId: args.issueId,
          message: `Archived issue ${args.issueId}`,
        }

        log(`[linear_archive_issue] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_archive_issue] Error:`, errorMessage)

        const result: LinearArchiveIssueResult = {
          success: false,
          issueId: args.issueId,
          message: `Failed to archive issue`,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}

export function createLinearGetIssueTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_GET_ISSUE_DESCRIPTION,
    args: {
      issueId: tool.schema.string().describe("Linear issue ID (e.g., 'LIF-123')"),
    },
    async execute(args: { issueId: string }): Promise<string> {
      log(`[linear_get_issue] Getting issue: ${args.issueId}`)

      if (!isLinearAvailable()) {
        const result: LinearGetIssueResult = {
          success: false,
          message: "LINEAR_API_KEY environment variable not set",
          error: "LINEAR_API_KEY not set",
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const issueResult = await getIssue(args.issueId)

        if (issueResult.error || !issueResult.issue) {
          const result: LinearGetIssueResult = {
            success: false,
            message: `Failed to get issue`,
            error: issueResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        const issue = issueResult.issue
        const result: LinearGetIssueResult = {
          success: true,
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            url: issue.url,
            status: issue.state.name,
            labels: issue.labels.nodes.map((l) => l.name),
          },
          message: `Found issue ${issue.identifier}: ${issue.title}`,
        }

        log(`[linear_get_issue] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_get_issue] Error:`, errorMessage)

        const result: LinearGetIssueResult = {
          success: false,
          message: `Failed to get issue`,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}

export function createLinearAddCommentTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_ADD_COMMENT_DESCRIPTION,
    args: {
      issueId: tool.schema.string().describe("Linear issue ID (e.g., 'LIF-123')"),
      body: tool.schema.string().describe("Comment text (Markdown supported)"),
    },
    async execute(args: { issueId: string; body: string }): Promise<string> {
      log(`[linear_add_comment] Adding comment to: ${args.issueId}`)

      if (!isLinearAvailable()) {
        const result: LinearAddCommentResult = {
          success: false,
          issueId: args.issueId,
          message: "LINEAR_API_KEY environment variable not set",
          error: "LINEAR_API_KEY not set",
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const commentResult = await createComment(args.issueId, args.body)

        if (!commentResult.success) {
          const result: LinearAddCommentResult = {
            success: false,
            issueId: args.issueId,
            message: `Failed to add comment`,
            error: commentResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        const result: LinearAddCommentResult = {
          success: true,
          issueId: args.issueId,
          message: `Added comment to ${args.issueId}`,
        }

        log(`[linear_add_comment] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_add_comment] Error:`, errorMessage)

        const result: LinearAddCommentResult = {
          success: false,
          issueId: args.issueId,
          message: `Failed to add comment`,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}
