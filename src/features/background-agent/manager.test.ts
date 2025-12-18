import { describe, test, expect, beforeEach } from "bun:test"
import type { BackgroundTask } from "./types"

class MockBackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map()

  addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) {
        result.push(task)
      }
    }
    return result
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)

    for (const child of directChildren) {
      result.push(child)
      const descendants = this.getAllDescendantTasks(child.sessionID)
      result.push(...descendants)
    }

    return result
  }
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; sessionID: string; parentSessionID: string }): BackgroundTask {
  return {
    parentMessageID: "mock-message-id",
    description: "test task",
    prompt: "test prompt",
    agent: "test-agent",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

describe("BackgroundManager.getAllDescendantTasks", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // #given
    manager = new MockBackgroundManager()
  })

  test("should return empty array when no tasks exist", () => {
    // #given - empty manager

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toEqual([])
  })

  test("should return direct children only when no nested tasks", () => {
    // #given
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    manager.addTask(taskB)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
  })

  test("should return all nested descendants (2 levels deep)", () => {
    // #given
    // Session A -> Task B -> Task C
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(2)
    expect(result.map(t => t.id)).toContain("task-b")
    expect(result.map(t => t.id)).toContain("task-c")
  })

  test("should return all nested descendants (3 levels deep)", () => {
    // #given
    // Session A -> Task B -> Task C -> Task D
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    })
    const taskD = createMockTask({
      id: "task-d",
      sessionID: "session-d",
      parentSessionID: "session-c",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)
    manager.addTask(taskD)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(3)
    expect(result.map(t => t.id)).toContain("task-b")
    expect(result.map(t => t.id)).toContain("task-c")
    expect(result.map(t => t.id)).toContain("task-d")
  })

  test("should handle multiple branches (tree structure)", () => {
    // #given
    // Session A -> Task B1 -> Task C1
    //           -> Task B2 -> Task C2
    const taskB1 = createMockTask({
      id: "task-b1",
      sessionID: "session-b1",
      parentSessionID: "session-a",
    })
    const taskB2 = createMockTask({
      id: "task-b2",
      sessionID: "session-b2",
      parentSessionID: "session-a",
    })
    const taskC1 = createMockTask({
      id: "task-c1",
      sessionID: "session-c1",
      parentSessionID: "session-b1",
    })
    const taskC2 = createMockTask({
      id: "task-c2",
      sessionID: "session-c2",
      parentSessionID: "session-b2",
    })
    manager.addTask(taskB1)
    manager.addTask(taskB2)
    manager.addTask(taskC1)
    manager.addTask(taskC2)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(4)
    expect(result.map(t => t.id)).toContain("task-b1")
    expect(result.map(t => t.id)).toContain("task-b2")
    expect(result.map(t => t.id)).toContain("task-c1")
    expect(result.map(t => t.id)).toContain("task-c2")
  })

  test("should not include tasks from unrelated sessions", () => {
    // #given
    // Session A -> Task B
    // Session X -> Task Y (unrelated)
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskY = createMockTask({
      id: "task-y",
      sessionID: "session-y",
      parentSessionID: "session-x",
    })
    manager.addTask(taskB)
    manager.addTask(taskY)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
    expect(result.map(t => t.id)).not.toContain("task-y")
  })

  test("getTasksByParentSession should only return direct children (not recursive)", () => {
    // #given
    // Session A -> Task B -> Task C
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)

    // #when
    const result = manager.getTasksByParentSession("session-a")

    // #then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
  })
})
