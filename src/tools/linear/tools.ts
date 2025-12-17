import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import {
  LINEAR_BRANCH_DESCRIPTION,
  LINEAR_UPDATE_STATUS_DESCRIPTION,
  LINEAR_CREATE_ISSUE_DESCRIPTION,
  DEFAULT_LINEAR_TEAM,
} from "./constants"
import type {
  LinearBranchResult,
  LinearUpdateStatusResult,
  LinearCreateIssueResult,
  LinearIssueStatus,
} from "./types"
import { STATUS_TO_STATE_TYPE } from "./types"

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
export function createLinearBranchTool(ctx: PluginInput) {
  return tool({
    description: LINEAR_BRANCH_DESCRIPTION,
    args: {
      issueId: tool.schema
        .string()
        .describe("Linear issue ID (e.g., 'LIF-123' or full UUID)"),
    },
    async execute(args: { issueId: string }): Promise<string> {
      log(`[linear_branch] Getting branch for issue: ${args.issueId}`)

      try {
        // Use Linear MCP to fetch issue details
        // The Linear MCP should be available via ctx.client.mcp
        const mcpResult = await ctx.client.mcp.call({
          server: "linear",
          method: "tools/call",
          params: {
            name: "linear_get_issue",
            arguments: { id: args.issueId },
          },
        })

        if (mcpResult.error) {
          log(`[linear_branch] MCP error:`, mcpResult.error)
          // Generate fallback branch name
          const fallbackBranch = generateFallbackBranch(args.issueId, "feature")
          const result: LinearBranchResult = {
            success: true,
            branchName: fallbackBranch,
            generated: true,
            issueTitle: "Unknown (Linear unavailable)",
            issueUrl: `https://linear.app/issue/${args.issueId}`,
            issueIdentifier: args.issueId,
          }
          return JSON.stringify(result, null, 2)
        }

        // Parse the MCP response
        const issueData = mcpResult.data as {
          branchName?: string
          title?: string
          url?: string
          identifier?: string
        }

        const branchName =
          issueData.branchName ||
          generateFallbackBranch(
            issueData.identifier || args.issueId,
            issueData.title || "feature"
          )

        const result: LinearBranchResult = {
          success: true,
          branchName,
          generated: !issueData.branchName,
          issueTitle: issueData.title || "Unknown",
          issueUrl: issueData.url || `https://linear.app/issue/${args.issueId}`,
          issueIdentifier: issueData.identifier || args.issueId,
        }

        log(`[linear_branch] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[linear_branch] Error:`, errorMessage)

        // Generate fallback on error
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
export function createLinearUpdateStatusTool(ctx: PluginInput) {
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

      try {
        // First, get the workflow states for the team to find the right state ID
        const stateType = STATUS_TO_STATE_TYPE[args.status]

        // Update the issue status via Linear MCP
        const updateResult = await ctx.client.mcp.call({
          server: "linear",
          method: "tools/call",
          params: {
            name: "linear_update_issue",
            arguments: {
              id: args.issueId,
              state: stateType,
            },
          },
        })

        if (updateResult.error) {
          log(`[linear_update_status] Update error:`, updateResult.error)
          const result: LinearUpdateStatusResult = {
            success: false,
            issueId: args.issueId,
            newStatus: args.status,
            commentAdded: false,
            message: `Failed to update issue status`,
            error: String(updateResult.error),
          }
          return JSON.stringify(result, null, 2)
        }

        // Add comment if provided
        let commentAdded = false
        if (args.comment) {
          const commentResult = await ctx.client.mcp.call({
            server: "linear",
            method: "tools/call",
            params: {
              name: "linear_create_comment",
              arguments: {
                issueId: args.issueId,
                body: args.comment,
              },
            },
          })
          commentAdded = !commentResult.error
          if (commentResult.error) {
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
export function createLinearCreateIssueTool(ctx: PluginInput) {
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
    },
    async execute(args: {
      title: string
      description?: string
      team?: string
      labels?: string[]
    }): Promise<string> {
      log(`[linear_create_issue] Creating issue: ${args.title}`)

      try {
        const createResult = await ctx.client.mcp.call({
          server: "linear",
          method: "tools/call",
          params: {
            name: "linear_create_issue",
            arguments: {
              title: args.title,
              description: args.description,
              team: args.team || DEFAULT_LINEAR_TEAM,
              labels: args.labels,
            },
          },
        })

        if (createResult.error) {
          log(`[linear_create_issue] Create error:`, createResult.error)
          const result: LinearCreateIssueResult = {
            success: false,
            message: `Failed to create issue`,
            error: String(createResult.error),
          }
          return JSON.stringify(result, null, 2)
        }

        const issueData = createResult.data as {
          id?: string
          identifier?: string
          url?: string
        }

        const result: LinearCreateIssueResult = {
          success: true,
          issueId: issueData.id,
          issueIdentifier: issueData.identifier,
          issueUrl: issueData.url,
          message: `Created issue ${issueData.identifier}: ${args.title}`,
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
