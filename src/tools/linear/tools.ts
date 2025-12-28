import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import {
  LINEAR_BRANCH_DESCRIPTION,
  LINEAR_UPDATE_STATUS_DESCRIPTION,
  LINEAR_CREATE_ISSUE_DESCRIPTION,
  LINEAR_ARCHIVE_ISSUE_DESCRIPTION,
  LINEAR_GET_ISSUE_DESCRIPTION,
  LINEAR_ADD_COMMENT_DESCRIPTION,
  LINEAR_UPDATE_ISSUE_DESCRIPTION,
  DEFAULT_LINEAR_TEAM,
  PRIORITY_MAP,
  PRIORITY_LABELS,
} from "./constants"
import type {
  LinearBranchResult,
  LinearUpdateStatusResult,
  LinearCreateIssueResult,
  LinearArchiveIssueResult,
  LinearGetIssueResult,
  LinearAddCommentResult,
  LinearIssueStatus,
  LinearPriority,
  LinearLabelOperations,
  LinearUpdateIssueInput,
  LinearFieldChange,
  LinearUpdateIssueResult,
  LinearIssueState,
} from "./types"
import { STATUS_TO_STATE_TYPE } from "./types"
import {
  getIssue,
  updateIssueState,
  createComment,
  createIssue,
  archiveIssue,
  isLinearAvailable,
  getIssueWithTeam,
  resolveLabelNames,
  updateIssue,
  type LinearIssueWithTeam,
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

export function validateLabelOperations(labels: LinearLabelOperations): { valid: boolean; error?: string } {
  const hasAdd = labels.add && labels.add.length > 0
  const hasRemove = labels.remove && labels.remove.length > 0
  const hasSet = labels.set !== undefined

  if (hasSet && (hasAdd || hasRemove)) {
    return {
      valid: false,
      error: "Cannot combine 'set' with 'add' or 'remove'. Use 'set' alone to replace all labels, or use 'add'/'remove' together for incremental changes.",
    }
  }

  return { valid: true }
}

export function normalizePriority(priority: LinearPriority): number {
  if (typeof priority === "number") {
    return Math.max(0, Math.min(4, priority))
  }
  return PRIORITY_MAP[priority.toLowerCase()] ?? 0
}

export function buildChangesArray(
  before: LinearIssueWithTeam,
  after: LinearIssueWithTeam,
  input: LinearUpdateIssueInput
): LinearFieldChange[] {
  const changes: LinearFieldChange[] = []

  if (input.title !== undefined && before.title !== after.title) {
    changes.push({ field: "title", from: before.title, to: after.title })
  }

  if (input.description !== undefined && before.description !== after.description) {
    changes.push({ field: "description", from: before.description ?? null, to: after.description ?? null })
  }

  if (input.priority !== undefined && before.priority !== after.priority) {
    changes.push({
      field: "priority",
      from: `${before.priority} (${before.priorityLabel})`,
      to: `${after.priority} (${after.priorityLabel})`,
    })
  }

  if (input.estimate !== undefined && before.estimate !== after.estimate) {
    changes.push({ field: "estimate", from: before.estimate ?? null, to: after.estimate ?? null })
  }

  if (input.dueDate !== undefined && before.dueDate !== after.dueDate) {
    changes.push({ field: "dueDate", from: before.dueDate ?? null, to: after.dueDate ?? null })
  }

  if (input.assigneeId !== undefined) {
    const beforeAssignee = before.assignee?.id ?? null
    const afterAssignee = after.assignee?.id ?? null
    if (beforeAssignee !== afterAssignee) {
      changes.push({
        field: "assignee",
        from: before.assignee ? `${before.assignee.name} (${before.assignee.email})` : null,
        to: after.assignee ? `${after.assignee.name} (${after.assignee.email})` : null,
      })
    }
  }

  if (input.labels !== undefined) {
    const beforeLabels = before.labels.nodes.map((l) => l.name).sort()
    const afterLabels = after.labels.nodes.map((l) => l.name).sort()
    if (JSON.stringify(beforeLabels) !== JSON.stringify(afterLabels)) {
      changes.push({ field: "labels", from: beforeLabels, to: afterLabels })
    }
  }

  return changes
}

export function buildCurrentState(issue: LinearIssueWithTeam): LinearIssueState {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    estimate: issue.estimate,
    dueDate: issue.dueDate,
    assignee: issue.assignee,
    labels: issue.labels.nodes.map((l) => l.name),
    url: issue.url,
  }
}

export function createLinearUpdateIssueTool(_ctx: PluginInput) {
  return tool({
    description: LINEAR_UPDATE_ISSUE_DESCRIPTION,
    args: {
      issueId: tool.schema.string().describe("Linear issue ID (e.g., 'LIF-123' or UUID)"),
      title: tool.schema.string().describe("New issue title").optional(),
      description: tool.schema.string().describe("New description (Markdown supported)").optional(),
      priority: tool.schema
        .union([
          tool.schema.number().describe("Priority as number (0-4)"),
          tool.schema.enum(["urgent", "high", "medium", "low", "none"] as const),
        ])
        .describe("Priority: 0-4 or 'urgent'/'high'/'medium'/'low'/'none'")
        .optional(),
      estimate: tool.schema.number().describe("Story point estimate").optional(),
      dueDate: tool.schema
        .union([tool.schema.string(), tool.schema.null()])
        .describe("Due date (YYYY-MM-DD) or null to clear")
        .optional(),
      assigneeId: tool.schema
        .union([tool.schema.string(), tool.schema.null()])
        .describe("Assignee user UUID or null to unassign")
        .optional(),
      labels: tool.schema
        .object({
          add: tool.schema.array(tool.schema.string()).describe("Labels to add").optional(),
          remove: tool.schema.array(tool.schema.string()).describe("Labels to remove").optional(),
          set: tool.schema.array(tool.schema.string()).describe("Replace all labels with this set").optional(),
        })
        .describe("Label operations (add/remove can be combined, set is exclusive)")
        .optional(),
    },
    async execute(args: LinearUpdateIssueInput): Promise<string> {
      log(`[linear_update_issue] Updating issue: ${args.issueId}`)

      if (!isLinearAvailable()) {
        const result: LinearUpdateIssueResult = {
          success: false,
          issueIdentifier: args.issueId,
          issueUrl: "",
          changes: [],
          message: "LINEAR_API_KEY environment variable not set",
          error: "LINEAR_API_KEY not set",
        }
        return JSON.stringify(result, null, 2)
      }

      const validationErrors: string[] = []

      if (args.labels) {
        const labelValidation = validateLabelOperations(args.labels)
        if (!labelValidation.valid) {
          validationErrors.push(labelValidation.error!)
        }
      }

      if (args.dueDate && args.dueDate !== null) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(args.dueDate)) {
          validationErrors.push(`Invalid date format: '${args.dueDate}'. Expected YYYY-MM-DD.`)
        }
      }

      if (validationErrors.length > 0) {
        const result: LinearUpdateIssueResult = {
          success: false,
          issueIdentifier: args.issueId,
          issueUrl: "",
          changes: [],
          message: "Validation failed",
          validationErrors,
        }
        return JSON.stringify(result, null, 2)
      }

      try {
        const beforeResult = await getIssueWithTeam(args.issueId)
        if (beforeResult.error || !beforeResult.issue) {
          const result: LinearUpdateIssueResult = {
            success: false,
            issueIdentifier: args.issueId,
            issueUrl: "",
            changes: [],
            message: "Failed to fetch issue",
            error: beforeResult.error || "Issue not found",
          }
          return JSON.stringify(result, null, 2)
        }

        const beforeIssue = beforeResult.issue
        const teamId = beforeIssue.team.id

        let addedLabelIds: string[] | undefined
        let removedLabelIds: string[] | undefined
        let labelIds: string[] | undefined

        if (args.labels) {
          if (args.labels.set !== undefined) {
            const resolution = await resolveLabelNames(teamId, args.labels.set)
            if (resolution.notFound.length > 0) {
              const result: LinearUpdateIssueResult = {
                success: false,
                issueIdentifier: beforeIssue.identifier,
                issueUrl: beforeIssue.url,
                changes: [],
                message: "Some labels not found",
                error: `Labels not found: ${resolution.notFound.join(", ")}`,
              }
              return JSON.stringify(result, null, 2)
            }
            labelIds = resolution.resolved
          } else {
            if (args.labels.add && args.labels.add.length > 0) {
              const resolution = await resolveLabelNames(teamId, args.labels.add)
              if (resolution.notFound.length > 0) {
                const result: LinearUpdateIssueResult = {
                  success: false,
                  issueIdentifier: beforeIssue.identifier,
                  issueUrl: beforeIssue.url,
                  changes: [],
                  message: "Some labels not found",
                  error: `Labels not found: ${resolution.notFound.join(", ")}`,
                }
                return JSON.stringify(result, null, 2)
              }
              addedLabelIds = resolution.resolved
            }

            if (args.labels.remove && args.labels.remove.length > 0) {
              const resolution = await resolveLabelNames(teamId, args.labels.remove)
              if (resolution.notFound.length > 0) {
                const result: LinearUpdateIssueResult = {
                  success: false,
                  issueIdentifier: beforeIssue.identifier,
                  issueUrl: beforeIssue.url,
                  changes: [],
                  message: "Some labels not found",
                  error: `Labels not found: ${resolution.notFound.join(", ")}`,
                }
                return JSON.stringify(result, null, 2)
              }
              removedLabelIds = resolution.resolved
            }
          }
        }

        const updateResult = await updateIssue({
          issueId: beforeIssue.id,
          title: args.title,
          description: args.description,
          priority: args.priority !== undefined ? normalizePriority(args.priority) : undefined,
          estimate: args.estimate,
          dueDate: args.dueDate,
          assigneeId: args.assigneeId,
          labelIds,
          addedLabelIds,
          removedLabelIds,
        })

        if (!updateResult.success || !updateResult.issue) {
          const result: LinearUpdateIssueResult = {
            success: false,
            issueIdentifier: beforeIssue.identifier,
            issueUrl: beforeIssue.url,
            changes: [],
            message: "Failed to update issue",
            error: updateResult.error,
          }
          return JSON.stringify(result, null, 2)
        }

        const afterIssue = updateResult.issue
        const changes = buildChangesArray(beforeIssue, afterIssue, args)
        const currentState = buildCurrentState(afterIssue)

        const changedFields = changes.map((c) => c.field).join(", ")
        const message =
          changes.length > 0
            ? `Updated ${afterIssue.identifier}: ${changedFields}`
            : `No changes made to ${afterIssue.identifier}`

        const result: LinearUpdateIssueResult = {
          success: true,
          issueIdentifier: afterIssue.identifier,
          issueUrl: afterIssue.url,
          changes,
          currentState,
          message,
        }

        log(`[linear_update_issue] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_update_issue] Error:`, errorMessage)

        const result: LinearUpdateIssueResult = {
          success: false,
          issueIdentifier: args.issueId,
          issueUrl: "",
          changes: [],
          message: "Failed to update issue",
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}
