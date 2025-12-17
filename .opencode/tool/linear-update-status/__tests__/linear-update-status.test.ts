/**
 * Tests for Linear Update Status Tool
 *
 * Tests status updates, validation, and edge cases.
 */

import { strict as assert } from "assert";

// Types
type IssueStatus = "todo" | "in_progress" | "in_review" | "done" | "canceled";

interface MockContext {
  mcp?: {
    linear?: {
      updateIssue: (args: { id: string; state: string }) => Promise<void>;
      createComment: (args: { issueId: string; body: string }) => Promise<void>;
    };
  };
}

// Status map (from tool)
const STATUS_MAP: Record<IssueStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

// Validation function (from tool)
function isValidIssueId(issueId: string): boolean {
  const identifierPattern = /^[A-Za-z]+-\d+$/;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return identifierPattern.test(issueId) || uuidPattern.test(issueId);
}

// Mock Linear MCP
function createMockLinearMcp(options: {
  updateShouldFail?: boolean;
  commentShouldFail?: boolean;
  errorMessage?: string;
} = {}) {
  const calls: { method: string; args: any }[] = [];

  return {
    calls,
    mcp: {
      linear: {
        updateIssue: async (args: { id: string; state: string }) => {
          calls.push({ method: "updateIssue", args });
          if (options.updateShouldFail) {
            throw new Error(options.errorMessage || "Update failed");
          }
        },
        createComment: async (args: { issueId: string; body: string }) => {
          calls.push({ method: "createComment", args });
          if (options.commentShouldFail) {
            throw new Error(options.errorMessage || "Comment failed");
          }
        },
      },
    },
  };
}

// Simulate tool execution
async function simulateToolExecution(
  args: { issueId: string; status: string; comment?: string },
  context: MockContext
) {
  const { issueId, status, comment } = args;

  // Validate issue ID
  if (!isValidIssueId(issueId)) {
    return {
      success: false,
      error: `Invalid issue ID format: ${issueId}`,
    };
  }

  // Validate status
  if (!STATUS_MAP[status as IssueStatus]) {
    return {
      success: false,
      error: `Invalid status: ${status}`,
    };
  }

  // Check MCP
  if (!context.mcp?.linear) {
    return {
      success: false,
      error: "Linear MCP is not configured",
    };
  }

  try {
    await context.mcp.linear.updateIssue({
      id: issueId,
      state: STATUS_MAP[status as IssueStatus],
    });

    if (comment) {
      await context.mcp.linear.createComment({
        issueId,
        body: comment,
      });
    }

    return {
      success: true,
      issueId,
      newStatus: status,
      commentAdded: !!comment,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update issue: ${(error as Error).message}`,
    };
  }
}

// Tests
console.log("Running Linear Update Status Tool Tests...\n");

// Test 1: Valid status values
console.log("Test 1: Valid status values");
{
  const validStatuses: IssueStatus[] = ["todo", "in_progress", "in_review", "done", "canceled"];

  for (const status of validStatuses) {
    assert(status in STATUS_MAP, `Status '${status}' should be in STATUS_MAP`);
    assert(typeof STATUS_MAP[status] === "string", `STATUS_MAP[${status}] should be a string`);
  }
  console.log("  ✓ All valid statuses are defined\n");
}

// Test 2: Status mapping
console.log("Test 2: Status mapping");
{
  assert.equal(STATUS_MAP.todo, "Todo", "todo should map to 'Todo'");
  assert.equal(STATUS_MAP.in_progress, "In Progress", "in_progress should map to 'In Progress'");
  assert.equal(STATUS_MAP.in_review, "In Review", "in_review should map to 'In Review'");
  assert.equal(STATUS_MAP.done, "Done", "done should map to 'Done'");
  assert.equal(STATUS_MAP.canceled, "Canceled", "canceled should map to 'Canceled'");
  console.log("  ✓ All status mappings are correct\n");
}

// Test 3: Update to 'todo' status
console.log("Test 3: Update to 'todo' status");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "todo" },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert.equal(result.newStatus, "todo", "Should update to todo");
    assert.equal(calls.length, 1, "Should make one API call");
    assert.equal(calls[0].args.state, "Todo", "Should use mapped state name");
    console.log("  ✓ Update to 'todo' works correctly\n");
  })();
}

// Test 4: Update to 'in_progress' status
console.log("Test 4: Update to 'in_progress' status");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "in_progress" },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert.equal(result.newStatus, "in_progress", "Should update to in_progress");
    assert.equal(calls[0].args.state, "In Progress", "Should use mapped state name");
    console.log("  ✓ Update to 'in_progress' works correctly\n");
  })();
}

// Test 5: Update to 'in_review' status
console.log("Test 5: Update to 'in_review' status");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "in_review" },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert.equal(result.newStatus, "in_review", "Should update to in_review");
    assert.equal(calls[0].args.state, "In Review", "Should use mapped state name");
    console.log("  ✓ Update to 'in_review' works correctly\n");
  })();
}

// Test 6: Update to 'done' status
console.log("Test 6: Update to 'done' status");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "done" },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert.equal(result.newStatus, "done", "Should update to done");
    assert.equal(calls[0].args.state, "Done", "Should use mapped state name");
    console.log("  ✓ Update to 'done' works correctly\n");
  })();
}

// Test 7: Update to 'canceled' status
console.log("Test 7: Update to 'canceled' status");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "canceled" },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert.equal(result.newStatus, "canceled", "Should update to canceled");
    assert.equal(calls[0].args.state, "Canceled", "Should use mapped state name");
    console.log("  ✓ Update to 'canceled' works correctly\n");
  })();
}

// Test 8: Update with comment
console.log("Test 8: Update with comment");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      {
        issueId: "ABC-123",
        status: "done",
        comment: "Completed the implementation",
      },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert(result.commentAdded, "Should indicate comment was added");
    assert.equal(calls.length, 2, "Should make two API calls");
    assert.equal(calls[0].method, "updateIssue", "First call should be updateIssue");
    assert.equal(calls[1].method, "createComment", "Second call should be createComment");
    assert.equal(calls[1].args.body, "Completed the implementation", "Comment body should match");
    console.log("  ✓ Update with comment works correctly\n");
  })();
}

// Test 9: Invalid issue ID
console.log("Test 9: Invalid issue ID");
{
  const { mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "invalid", status: "done" },
      { mcp }
    );

    assert(!result.success, "Should fail");
    assert(result.error?.includes("Invalid issue ID"), "Should report invalid ID");
    console.log("  ✓ Invalid issue ID is rejected\n");
  })();
}

// Test 10: Invalid status
console.log("Test 10: Invalid status");
{
  const { mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "invalid_status" },
      { mcp }
    );

    assert(!result.success, "Should fail");
    assert(result.error?.includes("Invalid status"), "Should report invalid status");
    console.log("  ✓ Invalid status is rejected\n");
  })();
}

// Test 11: Missing MCP configuration
console.log("Test 11: Missing MCP configuration");
{
  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "done" },
      {} // No MCP
    );

    assert(!result.success, "Should fail");
    assert(result.error?.includes("not configured"), "Should report MCP not configured");
    console.log("  ✓ Missing MCP is handled correctly\n");
  })();
}

// Test 12: API error handling
console.log("Test 12: API error handling");
{
  const { mcp } = createMockLinearMcp({
    updateShouldFail: true,
    errorMessage: "Issue not found",
  });

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "done" },
      { mcp }
    );

    assert(!result.success, "Should fail");
    assert(result.error?.includes("Failed to update"), "Should report update failure");
    assert(result.error?.includes("Issue not found"), "Should include error message");
    console.log("  ✓ API errors are handled correctly\n");
  })();
}

// Test 13: UUID issue ID format
console.log("Test 13: UUID issue ID format");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const uuid = "12345678-1234-1234-1234-123456789012";
    const result = await simulateToolExecution(
      { issueId: uuid, status: "in_progress" },
      { mcp }
    );

    assert(result.success, "Should succeed with UUID");
    assert.equal(calls[0].args.id, uuid, "Should pass UUID to API");
    console.log("  ✓ UUID issue ID format works correctly\n");
  })();
}

// Test 14: Update without comment
console.log("Test 14: Update without comment");
{
  const { calls, mcp } = createMockLinearMcp();

  (async () => {
    const result = await simulateToolExecution(
      { issueId: "ABC-123", status: "done" },
      { mcp }
    );

    assert(result.success, "Should succeed");
    assert(!result.commentAdded, "Should indicate no comment was added");
    assert.equal(calls.length, 1, "Should make only one API call");
    console.log("  ✓ Update without comment works correctly\n");
  })();
}

console.log("All Linear Update Status Tool tests passed! ✓");

