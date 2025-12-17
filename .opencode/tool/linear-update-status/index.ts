import { tool } from "@opencode-ai/plugin";

/**
 * Linear Update Status Tool
 *
 * Update the status of a Linear issue.
 * Convenience wrapper for common status transitions.
 */

type IssueStatus = "todo" | "in_progress" | "in_review" | "done" | "canceled";

interface SuccessResult {
  success: true;
  issueId: string;
  newStatus: IssueStatus;
  commentAdded: boolean;
  message: string;
}

interface ErrorResult {
  success: false;
  error: string;
  suggestion?: string;
}

type UpdateResult = SuccessResult | ErrorResult;

/**
 * Map friendly status names to Linear state names.
 * These are the default Linear workflow states.
 */
const STATUS_MAP: Record<IssueStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

/**
 * Validate issue ID format.
 * Accepts formats like: ABC-123, abc-123, or full UUIDs.
 */
function isValidIssueId(issueId: string): boolean {
  // Linear issue identifier format: TEAM-NUMBER or UUID
  const identifierPattern = /^[A-Za-z]+-\d+$/;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return identifierPattern.test(issueId) || uuidPattern.test(issueId);
}

export default tool({
  description:
    "Update a Linear issue's status. Use after completing work or changing task state.",

  args: {
    issueId: tool.schema.string().describe("The Linear issue ID (e.g., 'ABC-123')"),

    status: tool.schema
      .enum(["todo", "in_progress", "in_review", "done", "canceled"])
      .describe("New status for the issue"),

    comment: tool.schema
      .string()
      .optional()
      .describe("Optional comment to add with status change"),
  },

  async execute(args, context): Promise<string> {
    const { issueId, status, comment } = args;

    // Validate issue ID format
    if (!isValidIssueId(issueId)) {
      const result: ErrorResult = {
        success: false,
        error: `Invalid issue ID format: ${issueId}. Expected format: TEAM-123 or UUID`,
      };
      return JSON.stringify(result, null, 2);
    }

    // Validate status
    if (!STATUS_MAP[status as IssueStatus]) {
      const result: ErrorResult = {
        success: false,
        error: `Invalid status: ${status}. Valid values: ${Object.keys(STATUS_MAP).join(", ")}`,
      };
      return JSON.stringify(result, null, 2);
    }

    try {
      // Access Linear MCP through context
      const mcp = (context as any).mcp;

      if (!mcp?.linear) {
        const result: ErrorResult = {
          success: false,
          error:
            "Linear MCP is not configured. Please ensure Linear MCP is set up in opencode.json with a valid LINEAR_API_KEY.",
          suggestion:
            "Add Linear MCP configuration to opencode.json and set LINEAR_API_KEY environment variable",
        };
        return JSON.stringify(result, null, 2);
      }

      // Update issue status via Linear MCP
      await mcp.linear.updateIssue({
        id: issueId,
        state: STATUS_MAP[status as IssueStatus],
      });

      // Add comment if provided
      if (comment) {
        await mcp.linear.createComment({
          issueId,
          body: comment,
        });
      }

      const result: SuccessResult = {
        success: true,
        issueId,
        newStatus: status as IssueStatus,
        commentAdded: !!comment,
        message: `Issue ${issueId} updated to "${STATUS_MAP[status as IssueStatus]}"${comment ? " with comment" : ""}`,
      };
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Provide helpful suggestions based on error type
      let suggestion: string | undefined;
      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        suggestion = `Verify that issue ${issueId} exists in your Linear workspace`;
      } else if (
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("401")
      ) {
        suggestion = "Check that your LINEAR_API_KEY is valid and has write permissions";
      } else if (errorMessage.includes("state")) {
        suggestion = `The status "${STATUS_MAP[status as IssueStatus]}" may not exist in your Linear workflow. Check your team's workflow states.`;
      }

      const result: ErrorResult = {
        success: false,
        error: `Failed to update issue: ${errorMessage}`,
        suggestion,
      };
      return JSON.stringify(result, null, 2);
    }
  },
});

