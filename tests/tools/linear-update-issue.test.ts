/**
 * Tests for linear_update_issue tool (LIF-102)
 *
 * These tests verify the helper functions and constants for the
 * comprehensive Linear issue update functionality.
 */

import { describe, test, expect } from "bun:test"
import {
  validateLabelOperations,
  normalizePriority,
  buildChangesArray,
  buildCurrentState,
} from "../../src/tools/linear/tools"
import {
  PRIORITY_MAP,
  PRIORITY_LABELS,
  LINEAR_UPDATE_ISSUE_DESCRIPTION,
} from "../../src/tools/linear/constants"
import type {
  LinearPriority,
  LinearLabelOperations,
  LinearUpdateIssueInput,
} from "../../src/tools/linear/types"
import type { LinearIssueWithTeam } from "../../src/tools/linear/api"

// Helper to create mock LinearIssueWithTeam objects
function createMockIssue(overrides: Partial<LinearIssueWithTeam> = {}): LinearIssueWithTeam {
  return {
    id: "issue-uuid-123",
    identifier: "LIF-123",
    title: "Test Issue",
    description: "Test description",
    url: "https://linear.app/test/issue/LIF-123",
    priority: 3,
    priorityLabel: "Medium",
    estimate: 5,
    dueDate: "2025-01-15",
    state: {
      id: "state-uuid",
      name: "In Progress",
      type: "started",
    },
    labels: {
      nodes: [
        { id: "label-1", name: "Feature" },
        { id: "label-2", name: "Backend" },
      ],
    },
    team: {
      id: "team-uuid",
      labels: {
        nodes: [
          { id: "label-1", name: "Feature" },
          { id: "label-2", name: "Backend" },
          { id: "label-3", name: "Frontend" },
        ],
      },
    },
    ...overrides,
  }
}

describe("Linear Update Issue Tool (LIF-102)", () => {
  describe("Constants", () => {
    describe("PRIORITY_MAP", () => {
      test("should map 'none' to 0", () => {
        expect(PRIORITY_MAP.none).toBe(0)
      })

      test("should map 'urgent' to 1", () => {
        expect(PRIORITY_MAP.urgent).toBe(1)
      })

      test("should map 'high' to 2", () => {
        expect(PRIORITY_MAP.high).toBe(2)
      })

      test("should map 'medium' to 3", () => {
        expect(PRIORITY_MAP.medium).toBe(3)
      })

      test("should map 'low' to 4", () => {
        expect(PRIORITY_MAP.low).toBe(4)
      })

      test("should have exactly 5 priority levels", () => {
        expect(Object.keys(PRIORITY_MAP)).toHaveLength(5)
      })
    })

    describe("PRIORITY_LABELS", () => {
      test("should label 0 as 'No priority'", () => {
        expect(PRIORITY_LABELS[0]).toBe("No priority")
      })

      test("should label 1 as 'Urgent'", () => {
        expect(PRIORITY_LABELS[1]).toBe("Urgent")
      })

      test("should label 2 as 'High'", () => {
        expect(PRIORITY_LABELS[2]).toBe("High")
      })

      test("should label 3 as 'Medium'", () => {
        expect(PRIORITY_LABELS[3]).toBe("Medium")
      })

      test("should label 4 as 'Low'", () => {
        expect(PRIORITY_LABELS[4]).toBe("Low")
      })

      test("should have exactly 5 priority labels", () => {
        expect(Object.keys(PRIORITY_LABELS)).toHaveLength(5)
      })
    })

    describe("LINEAR_UPDATE_ISSUE_DESCRIPTION", () => {
      test("should be defined", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toBeDefined()
      })

      test("should mention title field", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("title")
      })

      test("should mention description field", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("description")
      })

      test("should mention priority field", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("priority")
      })

      test("should mention estimate field", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("estimate")
      })

      test("should mention dueDate field", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("dueDate")
      })

      test("should mention labels field", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("labels")
      })

      test("should mention partial update semantics", () => {
        expect(LINEAR_UPDATE_ISSUE_DESCRIPTION).toContain("partial update")
      })
    })
  })

  describe("validateLabelOperations", () => {
    describe("valid operations", () => {
      test("should allow add only", () => {
        const labels: LinearLabelOperations = { add: ["Feature", "Bug"] }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow remove only", () => {
        const labels: LinearLabelOperations = { remove: ["Feature"] }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow add + remove together", () => {
        const labels: LinearLabelOperations = {
          add: ["Feature"],
          remove: ["Bug"],
        }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow set only", () => {
        const labels: LinearLabelOperations = { set: ["Feature", "Backend"] }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow empty labels object", () => {
        const labels: LinearLabelOperations = {}
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow empty add array", () => {
        const labels: LinearLabelOperations = { add: [] }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow empty remove array", () => {
        const labels: LinearLabelOperations = { remove: [] }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      test("should allow set with empty array", () => {
        const labels: LinearLabelOperations = { set: [] }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })
    })

    describe("invalid operations", () => {
      test("should REJECT set + add combination", () => {
        const labels: LinearLabelOperations = {
          set: ["Feature"],
          add: ["Bug"],
        }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(false)
        expect(result.error).toContain("Cannot combine")
        expect(result.error).toContain("set")
      })

      test("should REJECT set + remove combination", () => {
        const labels: LinearLabelOperations = {
          set: ["Feature"],
          remove: ["Bug"],
        }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(false)
        expect(result.error).toContain("Cannot combine")
        expect(result.error).toContain("set")
      })

      test("should REJECT set + add + remove combination", () => {
        const labels: LinearLabelOperations = {
          set: ["Feature"],
          add: ["Bug"],
          remove: ["Backend"],
        }
        const result = validateLabelOperations(labels)
        expect(result.valid).toBe(false)
        expect(result.error).toContain("Cannot combine")
      })
    })
  })

  describe("normalizePriority", () => {
    describe("numeric priorities", () => {
      test("should return 0 as-is", () => {
        expect(normalizePriority(0)).toBe(0)
      })

      test("should return 1 as-is", () => {
        expect(normalizePriority(1)).toBe(1)
      })

      test("should return 2 as-is", () => {
        expect(normalizePriority(2)).toBe(2)
      })

      test("should return 3 as-is", () => {
        expect(normalizePriority(3)).toBe(3)
      })

      test("should return 4 as-is", () => {
        expect(normalizePriority(4)).toBe(4)
      })
    })

    describe("string priorities", () => {
      test("should convert 'urgent' to 1", () => {
        expect(normalizePriority("urgent")).toBe(1)
      })

      test("should convert 'high' to 2", () => {
        expect(normalizePriority("high")).toBe(2)
      })

      test("should convert 'medium' to 3", () => {
        expect(normalizePriority("medium")).toBe(3)
      })

      test("should convert 'low' to 4", () => {
        expect(normalizePriority("low")).toBe(4)
      })

      test("should convert 'none' to 0", () => {
        expect(normalizePriority("none")).toBe(0)
      })
    })

    describe("case insensitivity", () => {
      test("should handle 'URGENT' (uppercase)", () => {
        expect(normalizePriority("URGENT" as LinearPriority)).toBe(1)
      })

      test("should handle 'High' (mixed case)", () => {
        expect(normalizePriority("High" as LinearPriority)).toBe(2)
      })

      test("should handle 'MEDIUM' (uppercase)", () => {
        expect(normalizePriority("MEDIUM" as LinearPriority)).toBe(3)
      })

      test("should handle 'Low' (mixed case)", () => {
        expect(normalizePriority("Low" as LinearPriority)).toBe(4)
      })

      test("should handle 'NONE' (uppercase)", () => {
        expect(normalizePriority("NONE" as LinearPriority)).toBe(0)
      })
    })

    describe("out-of-range clamping", () => {
      test("should clamp negative numbers to 0", () => {
        expect(normalizePriority(-1 as LinearPriority)).toBe(0)
      })

      test("should clamp numbers > 4 to 4", () => {
        expect(normalizePriority(5 as LinearPriority)).toBe(4)
      })

      test("should clamp large numbers to 4", () => {
        expect(normalizePriority(100 as LinearPriority)).toBe(4)
      })
    })

    describe("unknown string handling", () => {
      test("should return 0 for unknown string", () => {
        expect(normalizePriority("unknown" as LinearPriority)).toBe(0)
      })
    })
  })

  describe("buildChangesArray", () => {
    describe("title changes", () => {
      test("should detect title change", () => {
        const before = createMockIssue({ title: "Old Title" })
        const after = createMockIssue({ title: "New Title" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", title: "New Title" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("title")
        expect(changes[0].from).toBe("Old Title")
        expect(changes[0].to).toBe("New Title")
      })

      test("should not detect title change when not in input", () => {
        const before = createMockIssue({ title: "Old Title" })
        const after = createMockIssue({ title: "New Title" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(0)
      })
    })

    describe("description changes", () => {
      test("should detect description change", () => {
        const before = createMockIssue({ description: "Old description" })
        const after = createMockIssue({ description: "New description" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", description: "New description" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("description")
        expect(changes[0].from).toBe("Old description")
        expect(changes[0].to).toBe("New description")
      })

      test("should handle null description", () => {
        const before = createMockIssue({ description: undefined })
        const after = createMockIssue({ description: "New description" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", description: "New description" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].from).toBeNull()
        expect(changes[0].to).toBe("New description")
      })
    })

    describe("priority changes", () => {
      test("should detect priority change", () => {
        const before = createMockIssue({ priority: 3, priorityLabel: "Medium" })
        const after = createMockIssue({ priority: 1, priorityLabel: "Urgent" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", priority: 1 }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("priority")
        expect(changes[0].from).toBe("3 (Medium)")
        expect(changes[0].to).toBe("1 (Urgent)")
      })
    })

    describe("estimate changes", () => {
      test("should detect estimate change", () => {
        const before = createMockIssue({ estimate: 5 })
        const after = createMockIssue({ estimate: 8 })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", estimate: 8 }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("estimate")
        expect(changes[0].from).toBe(5)
        expect(changes[0].to).toBe(8)
      })

      test("should handle null estimate", () => {
        const before = createMockIssue({ estimate: undefined })
        const after = createMockIssue({ estimate: 3 })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", estimate: 3 }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].from).toBeNull()
        expect(changes[0].to).toBe(3)
      })
    })

    describe("dueDate changes", () => {
      test("should detect dueDate change", () => {
        const before = createMockIssue({ dueDate: "2025-01-15" })
        const after = createMockIssue({ dueDate: "2025-02-01" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", dueDate: "2025-02-01" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("dueDate")
        expect(changes[0].from).toBe("2025-01-15")
        expect(changes[0].to).toBe("2025-02-01")
      })

      test("should detect dueDate cleared", () => {
        const before = createMockIssue({ dueDate: "2025-01-15" })
        const after = createMockIssue({ dueDate: undefined })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", dueDate: null }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].from).toBe("2025-01-15")
        expect(changes[0].to).toBeNull()
      })
    })

    describe("assignee changes", () => {
      test("should detect assignee change", () => {
        const before = createMockIssue({
          assignee: { id: "user-1", name: "John", email: "john@example.com" },
        })
        const after = createMockIssue({
          assignee: { id: "user-2", name: "Jane", email: "jane@example.com" },
        })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", assigneeId: "user-2" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("assignee")
        expect(changes[0].from).toBe("John (john@example.com)")
        expect(changes[0].to).toBe("Jane (jane@example.com)")
      })

      test("should detect assignee unassigned", () => {
        const before = createMockIssue({
          assignee: { id: "user-1", name: "John", email: "john@example.com" },
        })
        const after = createMockIssue({ assignee: undefined })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", assigneeId: null }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].from).toBe("John (john@example.com)")
        expect(changes[0].to).toBeNull()
      })

      test("should detect assignee assigned from none", () => {
        const before = createMockIssue({ assignee: undefined })
        const after = createMockIssue({
          assignee: { id: "user-1", name: "John", email: "john@example.com" },
        })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", assigneeId: "user-1" }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].from).toBeNull()
        expect(changes[0].to).toBe("John (john@example.com)")
      })
    })

    describe("label changes", () => {
      test("should detect label changes", () => {
        const before = createMockIssue({
          labels: { nodes: [{ id: "l1", name: "Feature" }] },
        })
        const after = createMockIssue({
          labels: { nodes: [{ id: "l1", name: "Feature" }, { id: "l2", name: "Bug" }] },
        })
        const input: LinearUpdateIssueInput = {
          issueId: "LIF-123",
          labels: { add: ["Bug"] },
        }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("labels")
        expect(changes[0].from).toEqual(["Feature"])
        expect(changes[0].to).toEqual(["Bug", "Feature"])
      })

      test("should not detect label changes when labels are same", () => {
        const before = createMockIssue({
          labels: { nodes: [{ id: "l1", name: "Feature" }] },
        })
        const after = createMockIssue({
          labels: { nodes: [{ id: "l1", name: "Feature" }] },
        })
        const input: LinearUpdateIssueInput = {
          issueId: "LIF-123",
          labels: { add: ["Feature"] },
        }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(0)
      })
    })

    describe("multiple changes", () => {
      test("should detect multiple field changes", () => {
        const before = createMockIssue({
          title: "Old Title",
          priority: 3,
          priorityLabel: "Medium",
          estimate: 5,
        })
        const after = createMockIssue({
          title: "New Title",
          priority: 1,
          priorityLabel: "Urgent",
          estimate: 8,
        })
        const input: LinearUpdateIssueInput = {
          issueId: "LIF-123",
          title: "New Title",
          priority: 1,
          estimate: 8,
        }

        const changes = buildChangesArray(before, after, input)

        expect(changes).toHaveLength(3)
        expect(changes.map((c) => c.field).sort()).toEqual(["estimate", "priority", "title"])
      })
    })

    describe("no changes", () => {
      test("should return empty array when no changes", () => {
        const issue = createMockIssue()
        const input: LinearUpdateIssueInput = { issueId: "LIF-123" }

        const changes = buildChangesArray(issue, issue, input)

        expect(changes).toHaveLength(0)
      })

      test("should return empty array when values are same", () => {
        const issue = createMockIssue({ title: "Same Title" })
        const input: LinearUpdateIssueInput = { issueId: "LIF-123", title: "Same Title" }

        const changes = buildChangesArray(issue, issue, input)

        expect(changes).toHaveLength(0)
      })
    })
  })

  describe("buildCurrentState", () => {
    test("should build complete state from issue", () => {
      const issue = createMockIssue({
        id: "uuid-123",
        identifier: "LIF-456",
        title: "Test Issue",
        description: "Test description",
        priority: 2,
        priorityLabel: "High",
        estimate: 5,
        dueDate: "2025-01-15",
        assignee: { id: "user-1", name: "John", email: "john@example.com" },
        labels: { nodes: [{ id: "l1", name: "Feature" }, { id: "l2", name: "Backend" }] },
        url: "https://linear.app/test/issue/LIF-456",
      })

      const state = buildCurrentState(issue)

      expect(state.id).toBe("uuid-123")
      expect(state.identifier).toBe("LIF-456")
      expect(state.title).toBe("Test Issue")
      expect(state.description).toBe("Test description")
      expect(state.priority).toBe(2)
      expect(state.priorityLabel).toBe("High")
      expect(state.estimate).toBe(5)
      expect(state.dueDate).toBe("2025-01-15")
      expect(state.assignee).toEqual({ id: "user-1", name: "John", email: "john@example.com" })
      expect(state.labels).toEqual(["Feature", "Backend"])
      expect(state.url).toBe("https://linear.app/test/issue/LIF-456")
    })

    test("should handle missing optional fields", () => {
      const issue = createMockIssue({
        description: undefined,
        estimate: undefined,
        dueDate: undefined,
        assignee: undefined,
      })

      const state = buildCurrentState(issue)

      expect(state.description).toBeUndefined()
      expect(state.estimate).toBeUndefined()
      expect(state.dueDate).toBeUndefined()
      expect(state.assignee).toBeUndefined()
    })

    test("should handle empty labels", () => {
      const issue = createMockIssue({
        labels: { nodes: [] },
      })

      const state = buildCurrentState(issue)

      expect(state.labels).toEqual([])
    })
  })
})

describe("Type Definitions (LIF-102)", () => {
  test("LinearPriority should accept numeric values", () => {
    const priorities: LinearPriority[] = [0, 1, 2, 3, 4]
    expect(priorities).toHaveLength(5)
  })

  test("LinearPriority should accept string values", () => {
    const priorities: LinearPriority[] = ["urgent", "high", "medium", "low", "none"]
    expect(priorities).toHaveLength(5)
  })

  test("LinearLabelOperations should have optional fields", () => {
    const ops1: LinearLabelOperations = {}
    const ops2: LinearLabelOperations = { add: ["Feature"] }
    const ops3: LinearLabelOperations = { remove: ["Bug"] }
    const ops4: LinearLabelOperations = { set: ["Feature", "Bug"] }
    const ops5: LinearLabelOperations = { add: ["Feature"], remove: ["Bug"] }

    expect(ops1).toBeDefined()
    expect(ops2.add).toEqual(["Feature"])
    expect(ops3.remove).toEqual(["Bug"])
    expect(ops4.set).toEqual(["Feature", "Bug"])
    expect(ops5.add).toEqual(["Feature"])
    expect(ops5.remove).toEqual(["Bug"])
  })

  test("LinearUpdateIssueInput should require issueId", () => {
    const input: LinearUpdateIssueInput = { issueId: "LIF-123" }
    expect(input.issueId).toBe("LIF-123")
  })

  test("LinearUpdateIssueInput should have optional fields", () => {
    const input: LinearUpdateIssueInput = {
      issueId: "LIF-123",
      title: "New Title",
      description: "New description",
      priority: "high",
      estimate: 5,
      dueDate: "2025-01-15",
      assigneeId: "user-uuid",
      labels: { add: ["Feature"] },
    }

    expect(input.title).toBe("New Title")
    expect(input.description).toBe("New description")
    expect(input.priority).toBe("high")
    expect(input.estimate).toBe(5)
    expect(input.dueDate).toBe("2025-01-15")
    expect(input.assigneeId).toBe("user-uuid")
    expect(input.labels?.add).toEqual(["Feature"])
  })
})
