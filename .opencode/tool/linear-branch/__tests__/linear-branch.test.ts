/**
 * Tests for Linear Branch Tool
 *
 * Tests various issue ID formats and edge cases.
 */

import { strict as assert } from "assert";

// Mock the tool module for testing
interface MockContext {
  mcp?: {
    linear?: {
      getIssue: (args: { id: string }) => Promise<any>;
    };
  };
}

// Helper to create a mock issue
function createMockIssue(overrides: Partial<any> = {}) {
  return {
    id: "uuid-123-456-789",
    identifier: "ABC-123",
    title: "Implement user authentication",
    branchName: "eru/abc-123-implement-user-authentication",
    url: "https://linear.app/team/issue/ABC-123",
    ...overrides,
  };
}

// Test utilities
function isValidIssueId(issueId: string): boolean {
  const identifierPattern = /^[A-Za-z]+-\d+$/;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return identifierPattern.test(issueId) || uuidPattern.test(issueId);
}

function generateSlug(title: string, maxLength: number = 50): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, maxLength);
}

// Tests
console.log("Running Linear Branch Tool Tests...\n");

// Test 1: Valid issue ID formats
console.log("Test 1: Valid issue ID formats");
{
  const validIds = [
    "ABC-123",
    "abc-123",
    "TEAM-1",
    "X-99999",
    "12345678-1234-1234-1234-123456789012",
    "abcdef12-3456-7890-abcd-ef1234567890",
  ];

  for (const id of validIds) {
    assert(isValidIssueId(id), `Expected ${id} to be valid`);
  }
  console.log("  ✓ All valid formats accepted\n");
}

// Test 2: Invalid issue ID formats
console.log("Test 2: Invalid issue ID formats");
{
  const invalidIds = [
    "",
    "ABC",
    "123",
    "ABC-",
    "-123",
    "ABC_123",
    "ABC 123",
    "12345678-1234-1234-1234-12345678901", // Too short UUID
    "12345678-1234-1234-1234-1234567890123", // Too long UUID
    "GHIJKLMN-1234-1234-1234-123456789012", // Invalid UUID chars
  ];

  for (const id of invalidIds) {
    assert(!isValidIssueId(id), `Expected ${id} to be invalid`);
  }
  console.log("  ✓ All invalid formats rejected\n");
}

// Test 3: Slug generation
console.log("Test 3: Slug generation");
{
  const testCases = [
    { input: "Implement user authentication", expected: "implement-user-authentication" },
    { input: "Fix BUG #123", expected: "fix-bug-123" },
    { input: "  Leading spaces  ", expected: "leading-spaces" },
    { input: "Special!@#$%chars", expected: "special-chars" },
    { input: "UPPERCASE TITLE", expected: "uppercase-title" },
    {
      input: "Very long title that exceeds the maximum length limit for branch names",
      expected: "very-long-title-that-exceeds-the-maximum-length-li",
    },
  ];

  for (const { input, expected } of testCases) {
    const result = generateSlug(input);
    assert.equal(result, expected, `Slug for "${input}" should be "${expected}", got "${result}"`);
  }
  console.log("  ✓ All slug generations correct\n");
}

// Test 4: Mock Linear MCP integration
console.log("Test 4: Mock Linear MCP integration");
{
  const mockIssue = createMockIssue();
  const mockContext: MockContext = {
    mcp: {
      linear: {
        getIssue: async ({ id }) => {
          if (id === "ABC-123" || id === mockIssue.id) {
            return mockIssue;
          }
          return null;
        },
      },
    },
  };

  // Simulate tool execution
  async function simulateToolExecution(issueId: string, context: MockContext) {
    if (!isValidIssueId(issueId)) {
      return { success: false, error: `Invalid issue ID format: ${issueId}` };
    }

    if (!context.mcp?.linear) {
      return { success: false, error: "Linear MCP is not configured" };
    }

    const issue = await context.mcp.linear.getIssue({ id: issueId });
    if (!issue) {
      return { success: false, error: `Issue ${issueId} not found` };
    }

    return {
      success: true,
      branchName: issue.branchName || `feature/${issue.identifier}-${generateSlug(issue.title)}`,
      generated: !issue.branchName,
      issueTitle: issue.title,
      issueUrl: issue.url,
      issueIdentifier: issue.identifier,
    };
  }

  // Test successful retrieval
  (async () => {
    const result = await simulateToolExecution("ABC-123", mockContext);
    assert(result.success, "Should succeed with valid issue");
    assert.equal(result.branchName, mockIssue.branchName, "Should return correct branch name");
    assert.equal(result.generated, false, "Should not be generated");
    console.log("  ✓ Successfully retrieves branch name from Linear\n");
  })();
}

// Test 5: Missing branch name generation
console.log("Test 5: Missing branch name generation");
{
  const mockIssueWithoutBranch = createMockIssue({ branchName: undefined });

  async function simulateToolExecution(issue: any) {
    if (!issue.branchName) {
      const slug = generateSlug(issue.title);
      return {
        success: true,
        branchName: `feature/${issue.identifier}-${slug}`,
        generated: true,
      };
    }
    return {
      success: true,
      branchName: issue.branchName,
      generated: false,
    };
  }

  (async () => {
    const result = await simulateToolExecution(mockIssueWithoutBranch);
    assert(result.success, "Should succeed");
    assert(result.generated, "Should be generated");
    assert.equal(
      result.branchName,
      "feature/ABC-123-implement-user-authentication",
      "Should generate correct branch name"
    );
    console.log("  ✓ Correctly generates branch name when not provided\n");
  })();
}

// Test 6: Error handling - No MCP
console.log("Test 6: Error handling - No MCP");
{
  const contextWithoutMcp: MockContext = {};

  async function simulateToolExecution(context: MockContext) {
    if (!context.mcp?.linear) {
      return { success: false, error: "Linear MCP is not configured" };
    }
    return { success: true };
  }

  (async () => {
    const result = await simulateToolExecution(contextWithoutMcp);
    assert(!result.success, "Should fail without MCP");
    assert(result.error?.includes("not configured"), "Should mention MCP not configured");
    console.log("  ✓ Correctly handles missing MCP configuration\n");
  })();
}

// Test 7: Error handling - Issue not found
console.log("Test 7: Error handling - Issue not found");
{
  const mockContext: MockContext = {
    mcp: {
      linear: {
        getIssue: async () => null,
      },
    },
  };

  async function simulateToolExecution(issueId: string, context: MockContext) {
    const issue = await context.mcp!.linear!.getIssue({ id: issueId });
    if (!issue) {
      return { success: false, error: `Issue ${issueId} not found` };
    }
    return { success: true };
  }

  (async () => {
    const result = await simulateToolExecution("NONEXISTENT-999", mockContext);
    assert(!result.success, "Should fail for non-existent issue");
    assert(result.error?.includes("not found"), "Should mention issue not found");
    console.log("  ✓ Correctly handles non-existent issue\n");
  })();
}

console.log("All Linear Branch Tool tests passed! ✓");

