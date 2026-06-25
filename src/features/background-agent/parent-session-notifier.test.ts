import { describe, expect, test } from "bun:test"

import { buildBackgroundTaskNotificationText } from "./background-task-notification-template"
import type { BackgroundTask } from "./types"

describe("notifyParentSession", () => {
  test("displays INTERRUPTED for interrupted tasks", () => {
    // given
    const task: BackgroundTask = {
      id: "test-task",
      parentSessionID: "parent-session",
      parentMessageID: "parent-message",
      description: "Test task",
      prompt: "Test prompt",
      agent: "test-agent",
      status: "interrupt",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const duration = "1s"
    const statusText = task.status === "completed" ? "COMPLETED" : task.status === "interrupt" ? "INTERRUPTED" : "CANCELLED"
    const allComplete = false
    const remainingCount = 1
    const completedTasks: BackgroundTask[] = []

    // when
    const notification = buildBackgroundTaskNotificationText({
      task,
      duration,
      statusText,
      allComplete,
      remainingCount,
      completedTasks,
    })

    // then
    expect(notification).toContain("INTERRUPTED")
  })
})