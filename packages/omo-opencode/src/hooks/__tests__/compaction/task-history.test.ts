/**
 * Tests for TaskHistory class
 * Validates task recording, compaction formatting, budget control, and cleanup
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { TaskHistory, type TaskHistoryEntry } from "../../../features/background-agent/task-history"

describe("TaskHistory", () => {
  let taskHistory: TaskHistory

  beforeEach(() => {
    taskHistory = new TaskHistory()
  })

  function createEntry(overrides: Partial<TaskHistoryEntry> = {}): TaskHistoryEntry {
    return {
      id: "task-1",
      agent: "explore",
      description: "Find auth patterns",
      status: "completed",
      ...overrides,
    }
  }

  describe("record", () => {
    it("records a new task entry", () => {
      // Given
      const parentSessionID = "parent-1"
      const entry = createEntry()

      // When
      taskHistory.record(parentSessionID, entry)

      // Then
      const entries = taskHistory.getByParentSession(parentSessionID)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual(entry)
    })

    it("updates an existing task entry", () => {
      // Given
      const parentSessionID = "parent-1"
      const entry = createEntry({ id: "task-1", status: "in_progress" })
      taskHistory.record(parentSessionID, entry)

      // When
      const updatedEntry = createEntry({ id: "task-1", status: "completed" })
      taskHistory.record(parentSessionID, updatedEntry)

      // Then
      const entries = taskHistory.getByParentSession(parentSessionID)
      expect(entries).toHaveLength(1)
      expect(entries[0].status).toBe("completed")
    })

    it("does not update when parentSessionID is undefined", () => {
      // Given
      const entry = createEntry()

      // When
      taskHistory.record(undefined, entry)

      // Then
      expect(taskHistory.getByParentSession("any")).toHaveLength(0)
    })

    it("enforces MAX_ENTRIES_PER_PARENT limit", () => {
      // Given: Record 101 entries
      const parentSessionID = "parent-1"
      for (let i = 0; i < 101; i++) {
        taskHistory.record(parentSessionID, createEntry({ id: `task-${i}` }))
      }

      // Then: Should only keep 100 entries (FIFO)
      const entries = taskHistory.getByParentSession(parentSessionID)
      expect(entries).toHaveLength(100)
      expect(entries[0].id).toBe("task-1") // First entry removed
      expect(entries[99].id).toBe("task-100") // Last entry kept
    })

    it("handles multiple parent sessions independently", () => {
      // Given
      const parent1 = "parent-1"
      const parent2 = "parent-2"

      // When
      taskHistory.record(parent1, createEntry({ id: "task-1" }))
      taskHistory.record(parent2, createEntry({ id: "task-2" }))

      // Then
      expect(taskHistory.getByParentSession(parent1)).toHaveLength(1)
      expect(taskHistory.getByParentSession(parent2)).toHaveLength(1)
      expect(taskHistory.getByParentSession(parent1)[0].id).toBe("task-1")
      expect(taskHistory.getByParentSession(parent2)[0].id).toBe("task-2")
    })
  })

  describe("getByParentSession", () => {
    it("returns empty array for unknown parent session", () => {
      // When
      const entries = taskHistory.getByParentSession("unknown")

      // Then
      expect(entries).toHaveLength(0)
    })

    it("returns a copy of entries (not reference)", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, createEntry())

      // When
      const entries1 = taskHistory.getByParentSession(parentSessionID)
      const entries2 = taskHistory.getByParentSession(parentSessionID)

      // Then
      expect(entries1).not.toBe(entries2) // Different array references
      expect(entries1).toEqual(entries2) // But same content
    })
  })

  describe("clearSession", () => {
    it("removes all entries for a parent session", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, createEntry({ id: "task-1" }))
      taskHistory.record(parentSessionID, createEntry({ id: "task-2" }))

      // When
      taskHistory.clearSession(parentSessionID)

      // Then
      expect(taskHistory.getByParentSession(parentSessionID)).toHaveLength(0)
    })

    it("does not affect other parent sessions", () => {
      // Given
      const parent1 = "parent-1"
      const parent2 = "parent-2"
      taskHistory.record(parent1, createEntry({ id: "task-1" }))
      taskHistory.record(parent2, createEntry({ id: "task-2" }))

      // When
      taskHistory.clearSession(parent1)

      // Then
      expect(taskHistory.getByParentSession(parent1)).toHaveLength(0)
      expect(taskHistory.getByParentSession(parent2)).toHaveLength(1)
    })
  })

  describe("clearAll", () => {
    it("removes all entries from all parent sessions", () => {
      // Given
      taskHistory.record("parent-1", createEntry({ id: "task-1" }))
      taskHistory.record("parent-2", createEntry({ id: "task-2" }))

      // When
      taskHistory.clearAll()

      // Then
      expect(taskHistory.getByParentSession("parent-1")).toHaveLength(0)
      expect(taskHistory.getByParentSession("parent-2")).toHaveLength(0)
    })
  })

  describe("formatForCompaction", () => {
    it("returns null when no entries exist", () => {
      // When
      const result = taskHistory.formatForCompaction("parent-1")

      // Then
      expect(result).toBeNull()
    })

    it("formats a single entry correctly", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, {
        id: "bg_abc123",
        agent: "explore",
        description: "Find auth patterns",
        status: "completed",
        category: "deep",
        sessionID: "ses_xyz789",
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).toContain("**explore**")
      expect(result).toContain("[deep]")
      expect(result).toContain("(completed)")
      expect(result).toContain("task_id: `bg_abc123`")
      expect(result).toContain("Find auth patterns")
      expect(result).toContain("session: `ses_xyz789`")
    })

    it("limits output to MAX_COMPACTION_ENTRIES (20)", () => {
      // Given: 25 entries
      const parentSessionID = "parent-1"
      for (let i = 0; i < 25; i++) {
        taskHistory.record(parentSessionID, createEntry({ id: `task-${i}` }))
      }

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).toContain("5 older delegated sessions omitted from compaction summary")
    })

    it("respects MAX_COMPACTION_TOTAL_CHARS budget (6000)", () => {
      // Given: Many long entries that exceed the 6000 char budget
      const parentSessionID = "parent-1"
      for (let i = 0; i < 50; i++) {
        taskHistory.record(parentSessionID, {
          id: `task-${i}`,
          agent: "explore",
          description: "A".repeat(500), // Very long description to exceed budget
          status: "completed",
        })
      }

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).not.toBeNull()
      expect(result!.length).toBeLessThanOrEqual(6000)
      // The output should contain either omission message
      expect(
        result!.includes("omitted to stay within compaction budget") ||
        result!.includes("omitted from compaction summary")
      ).toBe(true)
    })

    it("includes task_id for resumption", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, {
        id: "bg_unique_id_123",
        agent: "oracle",
        description: "Debug issue",
        status: "in_progress",
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).toContain("task_id: `bg_unique_id_123`")
    })

    it("truncates long descriptions", () => {
      // Given
      const parentSessionID = "parent-1"
      const longDescription = "A".repeat(300)
      taskHistory.record(parentSessionID, {
        id: "task-1",
        agent: "explore",
        description: longDescription,
        status: "completed",
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).toContain("... [truncated]")
    })

    it("normalizes whitespace in descriptions", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, {
        id: "task-1",
        agent: "explore",
        description: "Line 1\nLine 2\n\nLine 3",
        status: "completed",
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).not.toContain("\n\n")
      expect(result).toContain("Line 1 Line 2 Line 3")
    })

    it("replaces backticks with single quotes", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, {
        id: "task-1",
        agent: "explore",
        description: "Use `npm install` to install",
        status: "completed",
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).toContain("'npm install'")
      expect(result).not.toContain("``npm install``")
    })

    it("formats entries in reverse chronological order", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, createEntry({ id: "task-1", description: "First" }))
      taskHistory.record(parentSessionID, createEntry({ id: "task-2", description: "Second" }))
      taskHistory.record(parentSessionID, createEntry({ id: "task-3", description: "Third" }))

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      const thirdIndex = result!.indexOf("Third")
      const secondIndex = result!.indexOf("Second")
      const firstIndex = result!.indexOf("First")
      expect(thirdIndex).toBeLessThan(secondIndex)
      expect(secondIndex).toBeLessThan(firstIndex)
    })

    it("omits category when not provided", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, {
        id: "task-1",
        agent: "explore",
        description: "Find patterns",
        status: "completed",
        // No category
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).not.toContain("[undefined]")
      expect(result).toContain("**explore**")
    })

    it("omits sessionID when not provided", () => {
      // Given
      const parentSessionID = "parent-1"
      taskHistory.record(parentSessionID, {
        id: "task-1",
        agent: "explore",
        description: "Find patterns",
        status: "completed",
        // No sessionID
      })

      // When
      const result = taskHistory.formatForCompaction(parentSessionID)

      // Then
      expect(result).not.toContain("session:")
    })
  })
})
