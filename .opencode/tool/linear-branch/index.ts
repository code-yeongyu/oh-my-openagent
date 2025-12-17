import { tool } from "@opencode-ai/plugin";

/**
 * Linear Branch Tool
 *
 * Get the branch name for a Linear issue.
 *
 * Linear automatically generates branch names in the format:
 * {username}/{issue-id}-{issue-title-slug}
 *
 * This tool retrieves that branch name to ensure consistency.
 */

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  branchName?: string;
  url: string;
}

interface SuccessResult {
  success: true;
  branchName: string;
  generated: boolean;
  issueTitle: string;
  issueUrl: string;
  issueIdentifier: string;
}

interface ErrorResult {
  success: false;
  error: string;
}

type BranchResult = SuccessResult | ErrorResult;

/**
 * Generate a slug from a title string.
 * Converts to lowercase, replaces non-alphanumeric with hyphens,
 * removes leading/trailing hyphens, and truncates to maxLength.
 */
function generateSlug(title: string, maxLength: number = 50): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, maxLength);
}

/**
 * Validate issue ID format.
 * Accepts formats like: ABC-123, abc-123, or full UUIDs.
 */
function isValidIssueId(issueId: string): boolean {
  // Linear issue identifier format: TEAM-NUMBER or UUID
  const identifierPattern = /^[A-Za-z]+-\d+$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return identifierPattern.test(issueId) || uuidPattern.test(issueId);
}

export default tool({
  description:
    "Get the git branch name for a Linear issue. Use this before starting work to ensure correct branch naming.",

  args: {
    issueId: tool.schema
      .string()
      .describe("The Linear issue ID (e.g., 'ABC-123' or full UUID)"),
  },

  async execute(args, context): Promise<string> {
    const { issueId } = args;

    // Validate issue ID format
    if (!isValidIssueId(issueId)) {
      const result: ErrorResult = {
        success: false,
        error: `Invalid issue ID format: ${issueId}. Expected format: TEAM-123 or UUID`,
      };
      return JSON.stringify(result, null, 2);
    }

    try {
      // Access Linear MCP through context
      // The Linear MCP should be available as configured in opencode.json
      const mcp = (context as any).mcp;

      if (!mcp?.linear) {
        // Fallback: Provide instructions if MCP not available
        const result: ErrorResult = {
          success: false,
          error:
            "Linear MCP is not configured. Please ensure Linear MCP is set up in opencode.json with a valid LINEAR_API_KEY.",
        };
        return JSON.stringify(result, null, 2);
      }

      const issue: LinearIssue = await mcp.linear.getIssue({ id: issueId });

      if (!issue) {
        const result: ErrorResult = {
          success: false,
          error: `Issue ${issueId} not found`,
        };
        return JSON.stringify(result, null, 2);
      }

      const branchName = issue.branchName;

      if (!branchName) {
        // Generate a branch name if Linear doesn't have one
        const slug = generateSlug(issue.title);

        const result: SuccessResult = {
          success: true,
          branchName: `feature/${issue.identifier}-${slug}`,
          generated: true,
          issueTitle: issue.title,
          issueUrl: issue.url,
          issueIdentifier: issue.identifier,
        };
        return JSON.stringify(result, null, 2);
      }

      const result: SuccessResult = {
        success: true,
        branchName,
        generated: false,
        issueTitle: issue.title,
        issueUrl: issue.url,
        issueIdentifier: issue.identifier,
      };
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ErrorResult = {
        success: false,
        error: `Failed to get issue: ${errorMessage}`,
      };
      return JSON.stringify(result, null, 2);
    }
  },
});

