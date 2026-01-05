import { describe, test, expect, beforeEach } from "bun:test"
import { createBackgroundNotificationHook } from "./index"
import type { BackgroundTask } from "../../features/background-agent"

class MockBackgroundManager {
  private notifications: Map<string, BackgroundTask[]> = new Map()

  handleEvent = () => {}

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.notifications.get(sessionID) ?? []
  }

  clearNotifications(sessionID: string): void {
    this.notifications.delete(sessionID)
  }
}

function createMockTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: overrides.id ?? "task-123",
    sessionID: overrides.sessionID ?? "session-child",
    parentSessionID: overrides.parentSessionID ?? "session-parent",
    parentMessageID: overrides.parentMessageID ?? "msg-parent",
    description: overrides.description ?? "Test task",
    prompt: overrides.prompt ?? "Do something",
    agent: overrides.agent ?? "explore",
    status: overrides.status ?? "completed",
    startedAt: overrides.startedAt ?? new Date(Date.now() - 5000),
    completedAt: overrides.completedAt ?? new Date(),
    ...overrides,
  }
}

describe("background-notification hook", () => {
  let manager: MockBackgroundManager
  let hook: ReturnType<typeof createBackgroundNotificationHook>

  beforeEach(() => {
    manager = new MockBackgroundManager()
    hook = createBackgroundNotificationHook(manager as any)
  })

  test("should inject pending notifications at PreToolUse", async () => {
    // #given
    const task1 = createMockTask({
      id: "task-1",
      description: "First task",
      parentSessionID: "session-parent",
    })
    const task2 = createMockTask({
      id: "task-2",
      description: "Second task",
      parentSessionID: "session-parent",
    })
    manager.markForNotification(task1)
    manager.markForNotification(task2)

    // #when
    const result = await hook.PreToolUse!({
      tool: "read",
      sessionID: "session-parent",
      callID: "call-123",
    })

    // #then
    expect(result).toBeDefined()
    expect(result?.messages).toHaveLength(2)
    expect(result?.messages?.[0].role).toBe("user")
    expect(result?.messages?.[0].parts[0].text).toContain("BACKGROUND TASK COMPLETED")
    expect(result?.messages?.[0].parts[0].text).toContain("First task")
    expect(result?.messages?.[0].parts[0].text).toContain("task-1")
    expect(result?.messages?.[1].parts[0].text).toContain("Second task")
    expect(result?.messages?.[1].parts[0].text).toContain("task-2")
  })

  test("should clear notifications after injecting", async () => {
    // #given
    const task = createMockTask({ parentSessionID: "session-parent" })
    manager.markForNotification(task)

    // #when
    await hook.PreToolUse!({
      tool: "read",
      sessionID: "session-parent",
      callID: "call-123",
    })

    // #then
    expect(manager.getPendingNotifications("session-parent")).toHaveLength(0)
  })

  test("should return undefined when no pending notifications", async () => {
    // #when
    const result = await hook.PreToolUse!({
      tool: "read",
      sessionID: "session-parent",
      callID: "call-123",
    })

    // #then
    expect(result).toBeUndefined()
  })

  test("should not inject notifications for different session", async () => {
    // #given
    const task = createMockTask({ parentSessionID: "session-other" })
    manager.markForNotification(task)

    // #when
    const result = await hook.PreToolUse!({
      tool: "read",
      sessionID: "session-parent",
      callID: "call-123",
    })

    // #then
    expect(result).toBeUndefined()
    expect(manager.getPendingNotifications("session-other")).toHaveLength(1)
  })
})
