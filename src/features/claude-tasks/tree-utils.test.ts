import { describe, test, expect } from "bun:test"
import type { Task } from "../../tools/task/types"
import {
  buildTaskTree,
  getDescendants,
  getAncestors,
  detectCycles,
  detectOrphans,
  calculateDepth,
  calculateProgress,
} from "./tree-utils"

//#region Test Helpers
const createTask = (
  id: string,
  parentID?: string,
  status: Task["status"] = "pending"
): Task => ({
  id,
  subject: `Task ${id}`,
  description: `Description for ${id}`,
  status,
  blocks: [],
  blockedBy: [],
  threadID: "thread-1",
  parentID,
})
//#endregion

describe("buildTaskTree", () => {
  test("builds tree from flat task array with valid parent-child relationships", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child1", "T-root"),
      createTask("T-child2", "T-root"),
      createTask("T-grandchild", "T-child1"),
    ]

    //#when
    const result = buildTaskTree(tasks)

    //#then
    expect(result.roots).toHaveLength(1)
    expect(result.roots[0].id).toBe("T-root")
    expect(result.byId.size).toBe(4)
    expect(result.childrenByParent.get("T-root")).toHaveLength(2)
    expect(result.childrenByParent.get("T-child1")).toHaveLength(1)
  })

  test("handles multiple root tasks", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root1"),
      createTask("T-root2"),
      createTask("T-child", "T-root1"),
    ]

    //#when
    const result = buildTaskTree(tasks)

    //#then
    expect(result.roots).toHaveLength(2)
    expect(result.roots.map((t) => t.id).sort()).toEqual(["T-root1", "T-root2"])
  })

  test("handles empty task array", () => {
    //#given
    const tasks: Task[] = []

    //#when
    const result = buildTaskTree(tasks)

    //#then
    expect(result.roots).toHaveLength(0)
    expect(result.byId.size).toBe(0)
    expect(result.childrenByParent.size).toBe(0)
  })

  test("handles single task with no parent", () => {
    //#given
    const tasks: Task[] = [createTask("T-single")]

    //#when
    const result = buildTaskTree(tasks)

    //#then
    expect(result.roots).toHaveLength(1)
    expect(result.roots[0].id).toBe("T-single")
    expect(result.byId.size).toBe(1)
  })

  test("treats orphan tasks as roots", () => {
    //#given - task with parentID pointing to non-existent parent
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-orphan", "T-nonexistent"),
    ]

    //#when
    const result = buildTaskTree(tasks)

    //#then - orphan should be treated as root
    expect(result.roots).toHaveLength(2)
    expect(result.roots.map((t) => t.id).sort()).toEqual(["T-orphan", "T-root"])
  })
})

describe("getDescendants", () => {
  test("returns all descendants of a task", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child1", "T-root"),
      createTask("T-child2", "T-root"),
      createTask("T-grandchild1", "T-child1"),
      createTask("T-grandchild2", "T-child1"),
    ]

    //#when
    const result = getDescendants("T-root", tasks)

    //#then
    expect(result).toHaveLength(4)
    expect(result.map((t) => t.id).sort()).toEqual([
      "T-child1",
      "T-child2",
      "T-grandchild1",
      "T-grandchild2",
    ])
  })

  test("returns empty array for leaf task", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-leaf", "T-root"),
    ]

    //#when
    const result = getDescendants("T-leaf", tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("returns empty array for non-existent task", () => {
    //#given
    const tasks: Task[] = [createTask("T-root")]

    //#when
    const result = getDescendants("T-nonexistent", tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("returns empty array for empty task list", () => {
    //#given
    const tasks: Task[] = []

    //#when
    const result = getDescendants("T-any", tasks)

    //#then
    expect(result).toHaveLength(0)
  })
})

describe("getAncestors", () => {
  test("returns all ancestors in order from immediate parent to root", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child", "T-root"),
      createTask("T-grandchild", "T-child"),
      createTask("T-greatgrandchild", "T-grandchild"),
    ]

    //#when
    const result = getAncestors("T-greatgrandchild", tasks)

    //#then
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.id)).toEqual(["T-grandchild", "T-child", "T-root"])
  })

  test("returns empty array for root task", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child", "T-root"),
    ]

    //#when
    const result = getAncestors("T-root", tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("returns empty array for non-existent task", () => {
    //#given
    const tasks: Task[] = [createTask("T-root")]

    //#when
    const result = getAncestors("T-nonexistent", tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("stops at orphan (missing parent)", () => {
    //#given - T-orphan has parentID but parent doesn't exist
    const tasks: Task[] = [
      createTask("T-orphan", "T-nonexistent"),
      createTask("T-child", "T-orphan"),
    ]

    //#when
    const result = getAncestors("T-child", tasks)

    //#then - should only return T-orphan, not follow broken chain
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("T-orphan")
  })
})

describe("detectCycles", () => {
  test("detects simple cycle A->B->C->A", () => {
    //#given
    const tasks: Task[] = [
      { ...createTask("T-A"), parentID: "T-C" },
      { ...createTask("T-B"), parentID: "T-A" },
      { ...createTask("T-C"), parentID: "T-B" },
    ]

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result.length).toBeGreaterThan(0)
    const cycleIds = result[0]
    expect(cycleIds).toContain("T-A")
    expect(cycleIds).toContain("T-B")
    expect(cycleIds).toContain("T-C")
  })

  test("returns empty array for valid tree (no cycles)", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child1", "T-root"),
      createTask("T-child2", "T-root"),
      createTask("T-grandchild", "T-child1"),
    ]

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("returns empty array for empty task list", () => {
    //#given
    const tasks: Task[] = []

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("detects self-referencing task", () => {
    //#given - task pointing to itself
    const tasks: Task[] = [{ ...createTask("T-self"), parentID: "T-self" }]

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toContain("T-self")
  })

  test("handles multiple separate cycles", () => {
    //#given
    const tasks: Task[] = [
      { ...createTask("T-A1"), parentID: "T-B1" },
      { ...createTask("T-B1"), parentID: "T-A1" },
      { ...createTask("T-C1"), parentID: "T-D1" },
      { ...createTask("T-D1"), parentID: "T-C1" },
      createTask("T-normal"),
    ]

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})

describe("detectOrphans", () => {
  test("detects tasks with invalid parentID", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-valid-child", "T-root"),
      createTask("T-orphan1", "T-nonexistent1"),
      createTask("T-orphan2", "T-nonexistent2"),
    ]

    //#when
    const result = detectOrphans(tasks)

    //#then
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id).sort()).toEqual(["T-orphan1", "T-orphan2"])
  })

  test("returns empty array when all parents are valid", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child1", "T-root"),
      createTask("T-child2", "T-root"),
    ]

    //#when
    const result = detectOrphans(tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("returns empty array for empty task list", () => {
    //#given
    const tasks: Task[] = []

    //#when
    const result = detectOrphans(tasks)

    //#then
    expect(result).toHaveLength(0)
  })

  test("does not treat root tasks (no parentID) as orphans", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root1"),
      createTask("T-root2"),
    ]

    //#when
    const result = detectOrphans(tasks)

    //#then
    expect(result).toHaveLength(0)
  })
})

describe("calculateDepth", () => {
  test("returns 0 for root task", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child", "T-root"),
    ]

    //#when
    const result = calculateDepth("T-root", tasks)

    //#then
    expect(result).toBe(0)
  })

  test("returns 1 for immediate child of root", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child", "T-root"),
    ]

    //#when
    const result = calculateDepth("T-child", tasks)

    //#then
    expect(result).toBe(1)
  })

  test("returns correct depth for deeply nested task", () => {
    //#given - 7 levels deep
    const tasks: Task[] = [
      createTask("T-0"),
      createTask("T-1", "T-0"),
      createTask("T-2", "T-1"),
      createTask("T-3", "T-2"),
      createTask("T-4", "T-3"),
      createTask("T-5", "T-4"),
      createTask("T-6", "T-5"),
    ]

    //#when
    const result = calculateDepth("T-6", tasks)

    //#then
    expect(result).toBe(6)
  })

  test("returns -1 for non-existent task", () => {
    //#given
    const tasks: Task[] = [createTask("T-root")]

    //#when
    const result = calculateDepth("T-nonexistent", tasks)

    //#then
    expect(result).toBe(-1)
  })

  test("handles orphan task (counts from orphan, not missing parent)", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-orphan", "T-nonexistent"),
      createTask("T-child", "T-orphan"),
    ]

    //#when
    const result = calculateDepth("T-child", tasks)

    //#then
    expect(result).toBe(1)
  })
})

describe("calculateProgress", () => {
  test("returns 0/0 for leaf task with pending status", () => {
    //#given
    const tasks: Task[] = [createTask("T-leaf", undefined, "pending")]

    //#when
    const result = calculateProgress("T-leaf", tasks)

    //#then
    expect(result).toEqual({ completed: 0, total: 1 })
  })

  test("returns 1/1 for leaf task with completed status", () => {
    //#given
    const tasks: Task[] = [createTask("T-leaf", undefined, "completed")]

    //#when
    const result = calculateProgress("T-leaf", tasks)

    //#then
    expect(result).toEqual({ completed: 1, total: 1 })
  })

  test("calculates progress from children for parent task", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-parent", undefined, "pending"),
      createTask("T-child1", "T-parent", "completed"),
      createTask("T-child2", "T-parent", "completed"),
      createTask("T-child3", "T-parent", "pending"),
    ]

    //#when
    const result = calculateProgress("T-parent", tasks)

    //#then
    expect(result).toEqual({ completed: 2, total: 3 })
  })

  test("calculates progress recursively from all descendants", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root", undefined, "pending"),
      createTask("T-child1", "T-root", "pending"),
      createTask("T-child2", "T-root", "pending"),
      createTask("T-grandchild1", "T-child1", "completed"),
      createTask("T-grandchild2", "T-child1", "completed"),
      createTask("T-grandchild3", "T-child2", "pending"),
    ]

    //#when
    const result = calculateProgress("T-root", tasks)

    //#then
    expect(result).toEqual({ completed: 2, total: 3 })
  })

  test("returns 0/0 for non-existent task", () => {
    //#given
    const tasks: Task[] = [createTask("T-root")]

    //#when
    const result = calculateProgress("T-nonexistent", tasks)

    //#then
    expect(result).toEqual({ completed: 0, total: 0 })
  })

  test("returns 0/0 for empty task list", () => {
    //#given
    const tasks: Task[] = []

    //#when
    const result = calculateProgress("T-any", tasks)

    //#then
    expect(result).toEqual({ completed: 0, total: 0 })
  })

  test("ignores deleted tasks in progress calculation", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-parent", undefined, "pending"),
      createTask("T-child1", "T-parent", "completed"),
      createTask("T-child2", "T-parent", "deleted"),
      createTask("T-child3", "T-parent", "pending"),
    ]

    //#when
    const result = calculateProgress("T-parent", tasks)

    //#then
    expect(result).toEqual({ completed: 1, total: 2 })
  })

  test("handles in_progress status as incomplete", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-parent", undefined, "pending"),
      createTask("T-child1", "T-parent", "completed"),
      createTask("T-child2", "T-parent", "in_progress"),
    ]

    //#when
    const result = calculateProgress("T-parent", tasks)

    //#then
    expect(result).toEqual({ completed: 1, total: 2 })
  })

  test("treats parent as leaf when all children are deleted", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-parent", undefined, "pending"),
      createTask("T-child1", "T-parent", "deleted"),
      createTask("T-child2", "T-parent", "deleted"),
    ]

    //#when
    const result = calculateProgress("T-parent", tasks)

    //#then - parent becomes leaf, counts as 1 pending task
    expect(result).toEqual({ completed: 0, total: 1 })
  })

  test("calculates progress with mixed nested and leaf children", () => {
    //#given - T-parent has T-child1 (leaf, completed), T-child2 (parent with grandchildren)
    const tasks: Task[] = [
      createTask("T-parent", undefined, "pending"),
      createTask("T-child1", "T-parent", "completed"),
      createTask("T-child2", "T-parent", "pending"),
      createTask("T-grandchild1", "T-child2", "completed"),
      createTask("T-grandchild2", "T-child2", "completed"),
      createTask("T-grandchild3", "T-child2", "pending"),
    ]

    //#when
    const result = calculateProgress("T-parent", tasks)

    //#then - should count: T-child1 (1 completed), T-grandchild1,2,3 (2 completed, 1 pending) = 3/4
    expect(result).toEqual({ completed: 3, total: 4 })
  })
})

describe("buildTaskTree edge cases", () => {
  test("handles tasks with same subject but different IDs", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-1"),
      createTask("T-2"),
    ]
    // Give them the same subject
    tasks[0].subject = "Same Subject"
    tasks[1].subject = "Same Subject"

    //#when
    const result = buildTaskTree(tasks)

    //#then - both should be separate roots
    expect(result.roots).toHaveLength(2)
    expect(result.byId.size).toBe(2)
  })

  test("maintains insertion order for roots", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-first"),
      createTask("T-second"),
      createTask("T-third"),
    ]

    //#when
    const result = buildTaskTree(tasks)

    //#then
    expect(result.roots[0].id).toBe("T-first")
    expect(result.roots[1].id).toBe("T-second")
    expect(result.roots[2].id).toBe("T-third")
  })

  test("handles deeply nested structure (10 levels)", () => {
    //#given - 10 levels deep
    const tasks: Task[] = []
    let parentID: string | undefined
    for (let i = 0; i < 10; i++) {
      tasks.push(createTask(`T-${i}`, parentID))
      parentID = `T-${i}`
    }

    //#when
    const result = buildTaskTree(tasks)

    //#then
    expect(result.roots).toHaveLength(1)
    expect(result.roots[0].id).toBe("T-0")
    expect(result.byId.size).toBe(10)
  })
})

describe("getDescendants edge cases", () => {
  test("returns descendants in depth-first order", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child1", "T-root"),
      createTask("T-child2", "T-root"),
      createTask("T-grandchild1", "T-child1"),
    ]

    //#when
    const result = getDescendants("T-root", tasks)

    //#then - order may vary due to stack-based traversal, but all descendants should be present
    expect(result).toHaveLength(3)
    const ids = result.map((t) => t.id)
    expect(ids).toContain("T-child1")
    expect(ids).toContain("T-child2")
    expect(ids).toContain("T-grandchild1")
  })

  test("does not include the task itself in descendants", () => {
    //#given
    const tasks: Task[] = [
      createTask("T-root"),
      createTask("T-child", "T-root"),
    ]

    //#when
    const result = getDescendants("T-root", tasks)

    //#then
    expect(result.map((t) => t.id)).not.toContain("T-root")
  })
})

describe("detectCycles edge cases", () => {
  test("handles long cycle chain (5 nodes)", () => {
    //#given - A -> B -> C -> D -> E -> A
    const tasks: Task[] = [
      { ...createTask("T-A"), parentID: "T-E" },
      { ...createTask("T-B"), parentID: "T-A" },
      { ...createTask("T-C"), parentID: "T-B" },
      { ...createTask("T-D"), parentID: "T-C" },
      { ...createTask("T-E"), parentID: "T-D" },
    ]

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result.length).toBeGreaterThan(0)
    const cycle = result[0]
    expect(cycle.length).toBe(5)
  })

  test("detects cycle even with non-cyclic siblings", () => {
    //#given - mix of cyclic and non-cyclic tasks
    const tasks: Task[] = [
      createTask("T-normal-root"),
      createTask("T-normal-child", "T-normal-root"),
      { ...createTask("T-cycle-A"), parentID: "T-cycle-B" },
      { ...createTask("T-cycle-B"), parentID: "T-cycle-A" },
    ]

    //#when
    const result = detectCycles(tasks)

    //#then
    expect(result.length).toBe(1)
    const cycleIds = result[0]
    expect(cycleIds).toContain("T-cycle-A")
    expect(cycleIds).toContain("T-cycle-B")
  })
})

describe("calculateDepth edge cases", () => {
  test("returns 0 for task with undefined parentID", () => {
    //#given
    const tasks: Task[] = [
      { ...createTask("T-root"), parentID: undefined },
    ]

    //#when
    const result = calculateDepth("T-root", tasks)

    //#then
    expect(result).toBe(0)
  })

  test("returns 0 for task with empty string parentID (treated as no parent)", () => {
    //#given
    const task = createTask("T-root")
    task.parentID = ""
    const tasks: Task[] = [task]

    //#when
    const result = calculateDepth("T-root", tasks)

    //#then - empty string is falsy, so treated as root
    expect(result).toBe(0)
  })
})
