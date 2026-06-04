/**
 * Tests for hierarchical task tree markdown renderer (v2)
 *
 * BDD: //#given //#when //#then pattern
 */

import { describe, expect, it } from "bun:test"
import {
  renderTaskTree,
  renderNode,
  generateNumbering,
} from "./markdown-renderer-v2"
import { buildTaskTree } from "../../features/claude-tasks/tree-utils"
import type { Task } from "../../tools/task/types"

describe("generateNumbering", () => {
  //#given empty path array
  //#when generateNumbering is called
  //#then it returns empty string
  it("returns empty string for empty path", () => {
    const result = generateNumbering([])
    expect(result).toBe("")
  })

  //#given single-level path [1]
  //#when generateNumbering is called
  //#then it returns "1"
  it("generates single-level numbering", () => {
    const result = generateNumbering([1])
    expect(result).toBe("1")
  })

  //#given two-level path [1, 2]
  //#when generateNumbering is called
  //#then it returns "1.2"
  it("generates two-level numbering", () => {
    const result = generateNumbering([1, 2])
    expect(result).toBe("1.2")
  })

  //#given deep path [1, 2, 3, 4]
  //#when generateNumbering is called
  //#then it returns "1.2.3.4"
  it("generates deep hierarchical numbering", () => {
    const result = generateNumbering([1, 2, 3, 4])
    expect(result).toBe("1.2.3.4")
  })
})

describe("renderNode", () => {
  //#given a leaf task with no children
  //#when renderNode is called
  //#then it renders with full details and no progress indicator
  it("renders leaf node with full details", () => {
    const task: Task = {
      id: "T-leaf-1",
      subject: "Write unit tests",
      description: "Write comprehensive unit tests for the new feature",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    const result = renderNode(task, 0, [], tree, allTasks)

    expect(result).toContain("- [ ] 1. Write unit tests")
    expect(result).toContain("**What to do:**")
    expect(result).toContain("Write comprehensive unit tests")
    expect(result).not.toContain("[0/1]")
  })

  //#given a parent task with children
  //#when renderNode is called
  //#then it renders single line with progress indicator
  it("renders parent node as single line with progress", () => {
    const parent: Task = {
      id: "T-parent-1",
      subject: "Implement feature X",
      description: "Complete implementation of feature X",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const child1: Task = {
      id: "T-child-1",
      subject: "Design API",
      description: "Design the API",
      status: "completed",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const child2: Task = {
      id: "T-child-2",
      subject: "Write tests",
      description: "Write tests",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const allTasks = [parent, child1, child2]
    const tree = buildTaskTree(allTasks)

    const result = renderNode(parent, 0, [child1, child2], tree, allTasks)

    expect(result).toContain("- [ ] 1. Implement feature X")
    expect(result).toContain("[1/2]")
    expect(result).not.toContain("**What to do:**")
    expect(result).not.toContain("**Acceptance Criteria:**")
  })

  //#given a completed task
  //#when renderNode is called
  //#then checkbox is marked as checked
  it("renders completed task with checked checkbox", () => {
    const task: Task = {
      id: "T-done-1",
      subject: "Setup database",
      description: "Setup database",
      status: "completed",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    const result = renderNode(task, 0, [], tree, allTasks)

    expect(result).toContain("- [x] 1. Setup database")
  })

  //#given task at depth 2
  //#when renderNode is called
  //#then it has 4-space indentation (2 * depth)
  it("renders with correct indentation for depth", () => {
    const task: Task = {
      id: "T-deep-1",
      subject: "Subtask",
      description: "A subtask",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    const result = renderNode(task, 2, [], tree, allTasks)

    expect(result).toStartWith("    - [ ]") // 4 spaces for depth 2
  })

  //#given task with activeForm field
  //#when renderNode is called on leaf node
  //#then activeForm is rendered in acceptance criteria section
  it("includes activeForm in acceptance criteria for leaf", () => {
    const task: Task = {
      id: "T-active-1",
      subject: "Deploy to production",
      description: "Deploy the application",
      status: "in_progress",
      activeForm: "Deploying to production",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    const result = renderNode(task, 0, [], tree, allTasks)

    expect(result).toContain("**Acceptance Criteria:**")
    expect(result).toContain("Deploying to production")
  })
})

describe("renderTaskTree", () => {
  //#given empty task array
  //#when renderTaskTree is called
  //#then it returns empty string
  it("returns empty string for empty tree", () => {
    const result = renderTaskTree([])
    expect(result).toBe("")
  })

  //#given single root task with no children
  //#when renderTaskTree is called
  //#then it renders the single task
  it("renders single root task", () => {
    const task: Task = {
      id: "T-root-1",
      subject: "Root task",
      description: "Root description",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }

    const result = renderTaskTree([task])

    expect(result).toContain("- [ ] 1. Root task")
    expect(result).toContain("**What to do:**")
    expect(result).toContain("Root description")
  })

  //#given two-level tree (parent with one child)
  //#when renderTaskTree is called
  //#then it renders parent with progress and child with details
  it("renders simple two-level hierarchy", () => {
    const parent: Task = {
      id: "T-parent-1",
      subject: "Build feature",
      description: "Build the feature",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const child: Task = {
      id: "T-child-1",
      subject: "Write code",
      description: "Write the code",
      status: "completed",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const tasks = [parent, child]

    const result = renderTaskTree(tasks)

    expect(result).toContain("- [ ] 1. Build feature [1/1]")
    expect(result).toContain("  - [x] 1.1. Write code")
    expect(result).toContain("**What to do:**")
    expect(result).toContain("Write the code")
  })

  //#given three-level deep tree
  //#when renderTaskTree is called
  //#then it renders all levels with correct numbering
  it("renders three-level hierarchy with correct numbering", () => {
    const root: Task = {
      id: "T-root-1",
      subject: "Project",
      description: "Project desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const l1: Task = {
      id: "T-l1-1",
      subject: "Phase 1",
      description: "Phase 1 desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-root-1",
      threadID: "thread-1",
    }
    const l2: Task = {
      id: "T-l2-1",
      subject: "Task 1",
      description: "Task 1 desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-l1-1",
      threadID: "thread-1",
    }
    const tasks = [root, l1, l2]

    const result = renderTaskTree(tasks)

    expect(result).toContain("- [ ] 1. Project [0/1]")
    expect(result).toContain("  - [ ] 1.1. Phase 1 [0/1]")
    expect(result).toContain("    - [ ] 1.1.1. Task 1")
    expect(result).toContain("**What to do:**")
    expect(result).toContain("Task 1 desc")
  })

  //#given tree with multiple root tasks
  //#when renderTaskTree is called
  //#then it renders all roots with sequential numbering
  it("renders multiple root tasks", () => {
    const root1: Task = {
      id: "T-root-1",
      subject: "Task A",
      description: "Task A desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const root2: Task = {
      id: "T-root-2",
      subject: "Task B",
      description: "Task B desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const tasks = [root1, root2]

    const result = renderTaskTree(tasks)

    expect(result).toContain("- [ ] 1. Task A")
    expect(result).toContain("- [ ] 2. Task B")
  })

  //#given tree with deleted tasks
  //#when renderTaskTree is called
  //#then deleted tasks are filtered out
  it("filters out deleted tasks", () => {
    const active: Task = {
      id: "T-active-1",
      subject: "Active task",
      description: "Active",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const deleted: Task = {
      id: "T-deleted-1",
      subject: "Deleted task",
      description: "Deleted",
      status: "deleted",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const tasks = [active, deleted]

    const result = renderTaskTree(tasks)

    expect(result).toContain("Active task")
    expect(result).not.toContain("Deleted task")
  })

  //#given tree exceeding 6 levels deep
  //#when renderTaskTree is called
  //#then it renders up to 6 levels and shows warning for deeper nodes
  it("collapses nodes beyond 6 levels with warning", () => {
    // Build a 7-level tree
    const tasks: Task[] = []
    let parentID: string | undefined = undefined

    for (let i = 0; i < 7; i++) {
      const task: Task = {
        id: `T-level-${i}`,
        subject: `Level ${i} task`,
        description: `Level ${i} description`,
        status: "pending",
        blocks: [],
        blockedBy: [],
        parentID,
        threadID: "thread-1",
      }
      tasks.push(task)
      parentID = task.id
    }

    const result = renderTaskTree(tasks)

    // Should have 6 levels rendered
    expect(result).toContain("- [ ] 1. Level 0 task")
    expect(result).toContain("  - [ ] 1.1. Level 1 task")

    // Level 6 (7th level, depth index 6) should show warning
    expect(result).toContain("⚠️ Subtasks collapsed")
  })

  //#given complex tree with mixed completion states
  //#when renderTaskTree is called
  //#then progress indicators reflect actual completion
  it("calculates progress correctly across tree", () => {
    const root: Task = {
      id: "T-root-1",
      subject: "Root",
      description: "Root",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const child1: Task = {
      id: "T-child-1",
      subject: "Child 1",
      description: "Child 1",
      status: "completed",
      blocks: [],
      blockedBy: [],
      parentID: "T-root-1",
      threadID: "thread-1",
    }
    const child2: Task = {
      id: "T-child-2",
      subject: "Child 2",
      description: "Child 2",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-root-1",
      threadID: "thread-1",
    }
    const tasks = [root, child1, child2]

    const result = renderTaskTree(tasks)

    // Root should show [1/2] (1 completed out of 2 total)
    expect(result).toContain("[1/2]")
  })
})

describe("renderTaskTree edge cases", () => {
  it("renders multiple siblings at same level with sequential numbering", () => {
    //#given
    const parent: Task = {
      id: "T-parent-1",
      subject: "Parent",
      description: "Parent",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const child1: Task = {
      id: "T-child-1",
      subject: "First child",
      description: "First",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const child2: Task = {
      id: "T-child-2",
      subject: "Second child",
      description: "Second",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const child3: Task = {
      id: "T-child-3",
      subject: "Third child",
      description: "Third",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const tasks = [parent, child1, child2, child3]

    //#when
    const result = renderTaskTree(tasks)

    //#then
    expect(result).toContain("1.1. First child")
    expect(result).toContain("1.2. Second child")
    expect(result).toContain("1.3. Third child")
  })

  it("handles orphan tasks as separate roots", () => {
    //#given - task with parentID pointing to non-existent parent
    const validRoot: Task = {
      id: "T-root-1",
      subject: "Valid root",
      description: "Valid",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const orphan: Task = {
      id: "T-orphan-1",
      subject: "Orphan task",
      description: "Orphan",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-nonexistent",
      threadID: "thread-1",
    }
    const tasks = [validRoot, orphan]

    //#when
    const result = renderTaskTree(tasks)

    //#then - orphan treated as root
    expect(result).toContain("1. Valid root")
    expect(result).toContain("2. Orphan task")
  })

  it("filters deleted children from parent progress", () => {
    //#given
    const parent: Task = {
      id: "T-parent-1",
      subject: "Parent",
      description: "Parent",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const activeChild: Task = {
      id: "T-child-1",
      subject: "Active child",
      description: "Active",
      status: "completed",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const deletedChild: Task = {
      id: "T-child-2",
      subject: "Deleted child",
      description: "Deleted",
      status: "deleted",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const tasks = [parent, activeChild, deletedChild]

    //#when
    const result = renderTaskTree(tasks)

    //#then - only active child counted
    expect(result).toContain("[1/1]")
    expect(result).not.toContain("Deleted child")
  })

  it("aggregates progress across multiple levels", () => {
    //#given - root with child that has grandchildren
    const root: Task = {
      id: "T-root-1",
      subject: "Project",
      description: "Project",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const phase1: Task = {
      id: "T-phase-1",
      subject: "Phase 1",
      description: "Phase 1",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-root-1",
      threadID: "thread-1",
    }
    const task1: Task = {
      id: "T-task-1",
      subject: "Task 1",
      description: "Task 1",
      status: "completed",
      blocks: [],
      blockedBy: [],
      parentID: "T-phase-1",
      threadID: "thread-1",
    }
    const task2: Task = {
      id: "T-task-2",
      subject: "Task 2",
      description: "Task 2",
      status: "completed",
      blocks: [],
      blockedBy: [],
      parentID: "T-phase-1",
      threadID: "thread-1",
    }
    const task3: Task = {
      id: "T-task-3",
      subject: "Task 3",
      description: "Task 3",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-phase-1",
      threadID: "thread-1",
    }
    const tasks = [root, phase1, task1, task2, task3]

    //#when
    const result = renderTaskTree(tasks)

    //#then
    expect(result).toContain("1. Project [2/3]")
    expect(result).toContain("1.1. Phase 1 [2/3]")
  })

  it("renders only deleted tasks as empty string", () => {
    //#given
    const deleted1: Task = {
      id: "T-deleted-1",
      subject: "Deleted 1",
      description: "Deleted",
      status: "deleted",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const deleted2: Task = {
      id: "T-deleted-2",
      subject: "Deleted 2",
      description: "Deleted",
      status: "deleted",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const tasks = [deleted1, deleted2]

    //#when
    const result = renderTaskTree(tasks)

    //#then
    expect(result).toBe("")
  })

  it("handles task with no description gracefully", () => {
    //#given
    const task: Task = {
      id: "T-task-1",
      subject: "Task without description",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const tasks = [task]

    //#when
    const result = renderTaskTree(tasks)

    //#then
    expect(result).toContain("Task without description")
    expect(result).toContain("**What to do:**")
  })
})

describe("renderNode edge cases", () => {
  it("renders in_progress task with unchecked checkbox", () => {
    //#given
    const task: Task = {
      id: "T-task-1",
      subject: "In progress task",
      description: "Working on it",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    //#when
    const result = renderNode(task, 0, [], tree, allTasks)

    //#then - in_progress shows unchecked checkbox
    expect(result).toContain("- [ ]")
    expect(result).not.toContain("- [x]")
  })

  it("renders pending task with unchecked checkbox", () => {
    //#given
    const task: Task = {
      id: "T-task-1",
      subject: "Pending task",
      description: "Not started",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    //#when
    const result = renderNode(task, 0, [], tree, allTasks)

    //#then
    expect(result).toContain("- [ ]")
  })

  it("does not include activeForm for parent nodes", () => {
    //#given
    const parent: Task = {
      id: "T-parent-1",
      subject: "Parent task",
      description: "Parent desc",
      status: "in_progress",
      activeForm: "Should not appear",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const child: Task = {
      id: "T-child-1",
      subject: "Child task",
      description: "Child desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      parentID: "T-parent-1",
      threadID: "thread-1",
    }
    const allTasks = [parent, child]
    const tree = buildTaskTree(allTasks)

    //#when
    const result = renderNode(parent, 0, [child], tree, allTasks)

    //#then - parent node is single line, no activeForm
    expect(result).not.toContain("Should not appear")
    expect(result).not.toContain("**Acceptance Criteria:**")
  })

  it("renders leaf without activeForm omitting acceptance criteria section", () => {
    //#given
    const task: Task = {
      id: "T-task-1",
      subject: "Simple task",
      description: "Do something",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "thread-1",
    }
    const allTasks = [task]
    const tree = buildTaskTree(allTasks)

    //#when
    const result = renderNode(task, 0, [], tree, allTasks)

    //#then
    expect(result).toContain("**What to do:**")
    expect(result).not.toContain("**Acceptance Criteria:**")
  })
})
