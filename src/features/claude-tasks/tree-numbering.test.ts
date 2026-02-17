import { describe, it, expect } from "bun:test"
import type { Task } from "../../tools/task/types"
import { buildNumberedTree } from "./tree-numbering"

describe("buildNumberedTree", () => {
  //#given a set of tasks with parent-child relationships
  //#when buildNumberedTree is called
  //#then it builds a deterministic tree with lexical sibling ordering

  it("should return empty result for empty task list", () => {
    const result = buildNumberedTree([])
    const rootChildren = result.childrenByParent.get(undefined) ?? []
    expect(rootChildren).toEqual([])
    expect(result.taskNumbers.size).toBe(0)
    expect(result.orphans).toEqual([])
  })

  it("should build single root task with no children", () => {
    const tasks: Task[] = [
      {
        id: "T-001",
        subject: "Root task",
        description: "A root",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)
    expect(result.taskNumbers.get("T-001")).toEqual({
      depth: 0,
      numberingPath: [1],
    })
    const rootChildren = result.childrenByParent.get(undefined) ?? []
    expect(rootChildren).toHaveLength(1)
  })

  it("should order siblings lexically by task ID", () => {
    //#given three root tasks with IDs that are intentionally out of alphabetical order
    const tasks: Task[] = [
      {
        id: "T-zebra",
        subject: "Z task",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-apple",
        subject: "A task",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-banana",
        subject: "B task",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    //#then siblings should be sorted lexically by ID regardless of input order
    const rootChildren = result.childrenByParent.get(undefined) || []
    expect(rootChildren.map((t) => t.id)).toEqual(["T-apple", "T-banana", "T-zebra"])

    //#and numbering should reflect lexical order
    expect(result.taskNumbers.get("T-apple")?.numberingPath).toEqual([1])
    expect(result.taskNumbers.get("T-banana")?.numberingPath).toEqual([2])
    expect(result.taskNumbers.get("T-zebra")?.numberingPath).toEqual([3])
  })

  it("should produce deterministic output regardless of input order", () => {
    const tasks: Task[] = [
      {
        id: "T-003",
        subject: "Task 3",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-001",
        subject: "Task 1",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-002",
        subject: "Task 2",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    //#given the same tasks in different orders
    const result1 = buildNumberedTree(tasks)
    const shuffled = [tasks[2], tasks[0], tasks[3], tasks[1]]
    const result2 = buildNumberedTree(shuffled)

    //#then numbering should be identical
    expect(result1.taskNumbers.get("T-001")).toEqual(result2.taskNumbers.get("T-001"))
    expect(result1.taskNumbers.get("T-002")).toEqual(result2.taskNumbers.get("T-002"))
    expect(result1.taskNumbers.get("T-003")).toEqual(result2.taskNumbers.get("T-003"))
  })

  it("should assign correct depth to nested tasks", () => {
    const tasks: Task[] = [
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child",
        subject: "Child",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-grandchild",
        subject: "Grandchild",
        description: "",
        status: "pending",
        parentID: "T-child",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    expect(result.taskNumbers.get("T-root")?.depth).toBe(0)
    expect(result.taskNumbers.get("T-child")?.depth).toBe(1)
    expect(result.taskNumbers.get("T-grandchild")?.depth).toBe(2)
  })

  it("should assign correct numbering path for nested tasks", () => {
    const tasks: Task[] = [
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child-a",
        subject: "Child A",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child-b",
        subject: "Child B",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-grandchild",
        subject: "Grandchild of A",
        description: "",
        status: "pending",
        parentID: "T-child-a",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    expect(result.taskNumbers.get("T-root")?.numberingPath).toEqual([1])
    expect(result.taskNumbers.get("T-child-a")?.numberingPath).toEqual([1, 1])
    expect(result.taskNumbers.get("T-child-b")?.numberingPath).toEqual([1, 2])
    expect(result.taskNumbers.get("T-grandchild")?.numberingPath).toEqual([1, 1, 1])
  })

  it("should detect orphaned tasks (missing parent)", () => {
    const tasks: Task[] = [
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-orphan",
        subject: "Orphan",
        description: "",
        status: "pending",
        parentID: "T-nonexistent",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    expect(result.orphans).toHaveLength(1)
    expect(result.orphans[0].id).toBe("T-orphan")
  })

  it("should handle multiple orphans", () => {
    const tasks: Task[] = [
      {
        id: "T-orphan1",
        subject: "Orphan 1",
        description: "",
        status: "pending",
        parentID: "T-missing-1",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-orphan2",
        subject: "Orphan 2",
        description: "",
        status: "pending",
        parentID: "T-missing-2",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    expect(result.orphans).toHaveLength(2)
  })

  it("should exclude deleted tasks from tree numbering", () => {
    const tasks: Task[] = [
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child-deleted",
        subject: "Deleted child",
        description: "",
        status: "deleted",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child-active",
        subject: "Active child",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    //#then deleted task should not appear in childrenByParent
    const rootChildren = result.childrenByParent.get("T-root") || []
    expect(rootChildren.map((t) => t.id)).toEqual(["T-child-active"])

    //#but deleted task should still have numbering data (for reference)
    expect(result.taskNumbers.has("T-child-deleted")).toBe(true)
  })

  it("should enforce max depth of 6 and report violations", () => {
    let tasks: Task[] = [
      {
        id: "T-level-0",
        subject: "Level 0",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    //#given a chain of 7 nested tasks (depth 0-6)
    for (let i = 1; i <= 7; i++) {
      tasks.push({
        id: `T-level-${i}`,
        subject: `Level ${i}`,
        description: "",
        status: "pending",
        parentID: `T-level-${i - 1}`,
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      })
    }

    const result = buildNumberedTree(tasks)

    //#then depth 7 (index 7) should be recorded as exceeded
    expect(result.depthExceeded.length).toBeGreaterThan(0)
    expect(result.depthExceeded).toContain("T-level-7")
  })

  it("should include multi-level siblings in childrenByParent", () => {
    const tasks: Task[] = [
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-b-child",
        subject: "B Child",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-a-child",
        subject: "A Child",
        description: "",
        status: "pending",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-b-grandchild",
        subject: "B Grandchild",
        description: "",
        status: "pending",
        parentID: "T-b-child",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)

    //#then root's children should be sorted lexically
    const rootChildren = result.childrenByParent.get("T-root") || []
    expect(rootChildren.map((t) => t.id)).toEqual(["T-a-child", "T-b-child"])

    //#and B-child's children should be present
    const bChildren = result.childrenByParent.get("T-b-child") || []
    expect(bChildren.map((t) => t.id)).toEqual(["T-b-grandchild"])
  })

  it("should number deleted root tasks correctly", () => {
    const tasks: Task[] = [
      {
        id: "T-deleted-root",
        subject: "Deleted Root",
        description: "",
        status: "deleted",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-active-root",
        subject: "Active Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)
    
    // Should be numbered based on sorted ID order:
    // T-active-root (1)
    // T-deleted-root (2)
    
    expect(result.taskNumbers.has("T-deleted-root")).toBe(true)
    const numbering = result.taskNumbers.get("T-deleted-root")
    expect(numbering).toBeDefined()
    expect(numbering?.numberingPath).toEqual([2])
  })

  it("should assign unique indices to multiple deleted siblings", () => {
    const tasks: Task[] = [
      {
        id: "T-root",
        subject: "Root",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child-1-deleted",
        subject: "Deleted Child 1",
        description: "",
        status: "deleted",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
      {
        id: "T-child-2-deleted",
        subject: "Deleted Child 2",
        description: "",
        status: "deleted",
        parentID: "T-root",
        blocks: [],
        blockedBy: [],
        threadID: "thread-1",
      },
    ]

    const result = buildNumberedTree(tasks)
    
    const child1Num = result.taskNumbers.get("T-child-1-deleted")
    const child2Num = result.taskNumbers.get("T-child-2-deleted")

    expect(child1Num).toBeDefined()
    expect(child2Num).toBeDefined()

    // Sorted by ID: T-child-1-deleted, T-child-2-deleted
    expect(child1Num?.numberingPath).toEqual([1, 1])
    expect(child2Num?.numberingPath).toEqual([1, 2])
    
    // Explicit check against duplicate indices
    expect(child1Num?.numberingPath).not.toEqual(child2Num?.numberingPath)
  })
})
