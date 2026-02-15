import { describe, it, expect } from "bun:test"
import type { Task } from "./types"
import {
  validateParentExists,
  validateNoCycles,
  validateMaxDepth,
  validateReparentingDepth,
} from "./validation"

describe("Task Validation", () => {
  //#given a set of tasks
  describe("validateParentExists", () => {
    //#when parent is null/unset
    it("should return null when parentID is unset", () => {
      const tasks: Task[] = []
      const result = validateParentExists(undefined, tasks)
      expect(result).toBeNull()
    })

    //#when parent exists in task list
    it("should return null when parent exists", () => {
      const tasks: Task[] = [
        {
          id: "T-parent",
          subject: "Parent",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
        },
        {
          id: "T-child",
          subject: "Child",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
          parentID: "T-parent",
        },
      ]
      const result = validateParentExists("T-parent", tasks)
      expect(result).toBeNull()
    })

    //#when parent does not exist
    it("should return error when parent does not exist", () => {
      const tasks: Task[] = []
      const result = validateParentExists("T-nonexistent", tasks)
      expect(result).toEqual({ error: "task_parent_not_found" })
    })
  })

  describe("validateNoCycles", () => {
    //#given a linear chain
    it("should return null for valid chain A -> B -> C", () => {
      const tasks: Task[] = [
        {
          id: "T-a",
          subject: "A",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
        },
        {
          id: "T-b",
          subject: "B",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
          parentID: "T-a",
        },
        {
          id: "T-c",
          subject: "C",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
          parentID: "T-b",
        },
      ]
      const result = validateNoCycles("T-c", "T-b", tasks)
      expect(result).toBeNull()
    })

    //#when creating A -> B and B -> A (direct cycle)
    it("should reject direct cycle A <- B <- A", () => {
      const tasks: Task[] = [
        {
          id: "T-a",
          subject: "A",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
          parentID: "T-b",
        },
        {
          id: "T-b",
          subject: "B",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
        },
      ]
      // Try to set B's parent to A (which has parent B) = cycle
      const result = validateNoCycles("T-b", "T-a", tasks)
      expect(result).toEqual({ error: "task_cycle_detected" })
    })

    //#when creating A -> B -> C -> A (indirect cycle)
    it("should reject indirect cycle A <- C <- B <- A", () => {
      const tasks: Task[] = [
        {
          id: "T-a",
          subject: "A",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
        },
        {
          id: "T-b",
          subject: "B",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
          parentID: "T-a",
        },
        {
          id: "T-c",
          subject: "C",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
          parentID: "T-b",
        },
      ]
      // Try to set A's parent to C = cycle
      const result = validateNoCycles("T-a", "T-c", tasks)
      expect(result).toEqual({ error: "task_cycle_detected" })
    })

    //#when parent is self
    it("should reject self-cycle", () => {
      const tasks: Task[] = [
        {
          id: "T-a",
          subject: "A",
          description: "",
          status: "pending",
          threadID: "test",
          blocks: [],
          blockedBy: [],
        },
      ]
      // Try to set A's parent to A = cycle
      const result = validateNoCycles("T-a", "T-a", tasks)
      expect(result).toEqual({ error: "task_cycle_detected" })
    })
  })

  describe("validateMaxDepth", () => {
    //#when task is within max depth (6)
    it("should return null for depth 0 (root)", () => {
      const tasks: Task[] = []
      const result = validateMaxDepth("T-root", tasks)
      expect(result).toBeNull()
    })

    it("should return null for depth 5", () => {
      const tasks: Task[] = [
        { id: "T-1", subject: "1", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [] },
        { id: "T-2", subject: "2", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-1" },
        { id: "T-3", subject: "3", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-2" },
        { id: "T-4", subject: "4", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-3" },
        { id: "T-5", subject: "5", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-4" },
        { id: "T-6", subject: "6", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-5" },
      ]
      const result = validateMaxDepth("T-6", tasks)
      expect(result).toBeNull()
    })

    //#when task exceeds max depth (6)
    it("should reject depth 6 (7th level in 0-indexed)", () => {
      const tasks: Task[] = [
        { id: "T-1", subject: "1", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [] },
        { id: "T-2", subject: "2", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-1" },
        { id: "T-3", subject: "3", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-2" },
        { id: "T-4", subject: "4", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-3" },
        { id: "T-5", subject: "5", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-4" },
        { id: "T-6", subject: "6", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-5" },
        { id: "T-7", subject: "7", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-6" },
      ]
      const result = validateMaxDepth("T-7", tasks)
      expect(result).toEqual({ error: "task_max_depth_exceeded" })
    })
  })

  describe("validateReparentingDepth", () => {
    //#when reparenting doesn't push descendants beyond max depth
    it("should return null when reparenting stays within limit", () => {
      const tasks: Task[] = [
        { id: "T-1", subject: "1", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [] },
        { id: "T-2", subject: "2", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-1" },
        { id: "T-3", subject: "3", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-2" },
        { id: "T-child", subject: "C", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-3" },
        { id: "T-grandchild", subject: "GC", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-child" },
      ]
      // Move T-3 (at depth 2) under T-1 (at depth 0) = T-3 becomes depth 1, T-child = 2, T-grandchild = 3 ✓
      const result = validateReparentingDepth("T-3", "T-1", tasks)
      expect(result).toBeNull()
    })

    //#when reparenting pushes descendants beyond max depth
    it("should reject reparenting that exceeds max depth for descendants", () => {
      const tasks: Task[] = [
        { id: "T-1", subject: "1", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [] },
        { id: "T-2", subject: "2", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-1" },
        { id: "T-3", subject: "3", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-2" },
        { id: "T-4", subject: "4", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-3" },
        { id: "T-5", subject: "5", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-4" },
        { id: "T-6", subject: "6", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-5" },
        { id: "T-child", subject: "C", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-6" },
        { id: "T-grandchild", subject: "GC", description: "", status: "pending", threadID: "test", blocks: [], blockedBy: [], parentID: "T-child" },
      ]
      // Try to move T-1 (depth 0) to parent of T-6 (depth 5)
      // T-6 becomes depth 6, T-child = 7, T-grandchild = 8 ✗
      const result = validateReparentingDepth("T-1", "T-6", tasks)
      expect(result).toEqual({ error: "task_max_depth_exceeded" })
    })
  })
})
