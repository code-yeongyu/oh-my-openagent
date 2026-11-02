import { describe, expect, test } from "bun:test"
import { buildBackgroundTaskNotificationText } from "./background-task-notification-template"
import type { BackgroundTaskNotificationTask } from "./background-task-notification-template"

// Contract (#8325): a provider error is embedded into the parent session's context, so every
// notification field that carries one stays bounded however long the stored error is.
const HUGE_ERROR = `Invalid value at tools (TYPE_STRING), false; Status: 400 ${"x".repeat(600_000)}`
const NOTIFICATION_CEILING = 20_000

function failedTask(id: string): BackgroundTaskNotificationTask {
  return {
    id,
    description: `Failed ${id}`,
    status: "error",
    error: HUGE_ERROR,
    attempts: [
      {
        attemptId: `${id}-att-1`,
        attemptNumber: 1,
        sessionId: `${id}-ses-1`,
        providerId: "google",
        modelId: "flash",
        status: "error",
        error: HUGE_ERROR,
      },
      {
        attemptId: `${id}-att-2`,
        attemptNumber: 2,
        sessionId: `${id}-ses-2`,
        providerId: "anthropic",
        modelId: "haiku",
        status: "error",
        error: HUGE_ERROR,
      },
    ],
  }
}

describe("background task notification error bound", () => {
  test("#given a failed task with a huge provider error #when the single-task notification is built #then the error field is bounded and keeps its head", () => {
    const notification = buildBackgroundTaskNotificationText({
      task: failedTask("bg_single"),
      duration: "3s",
      statusText: "ERROR",
      allComplete: false,
      remainingCount: 1,
      completedTasks: [],
    })

    expect(notification.length).toBeLessThan(NOTIFICATION_CEILING)
    expect(notification).toContain("**Error:** Invalid value at tools (TYPE_STRING), false; Status: 400")
    expect(notification).toContain(`(truncated, ${HUGE_ERROR.length} chars)`)
  })

  test("#given several failed siblings with huge errors #when the final notification is built #then status suffixes and attempt timelines are bounded", () => {
    const tasks = ["bg_a", "bg_b", "bg_c", "bg_d"].map(failedTask)
    const notification = buildBackgroundTaskNotificationText({
      task: tasks[0]!,
      duration: "9s",
      statusText: "ERROR",
      allComplete: true,
      remainingCount: 0,
      completedTasks: tasks,
    })

    // 4 tasks x (1 status suffix + 2 attempt lines) = 12 embedded errors
    expect(notification.length).toBeLessThan(12 * 2_100 + 4_000)
    expect(notification).toContain("[ERROR] - Invalid value at tools (TYPE_STRING)")
    expect(notification).toContain("    Error: Invalid value at tools (TYPE_STRING)")
    expect(notification.split(`(truncated, ${HUGE_ERROR.length} chars)`).length - 1).toBe(12)
  })

  test("#given a short provider error #when notifications are built #then the error text is embedded unchanged", () => {
    const shortError = "Forbidden: Selected provider is forbidden"
    const notification = buildBackgroundTaskNotificationText({
      task: { id: "bg_short", description: "Short", status: "error", error: shortError },
      duration: "1s",
      statusText: "ERROR",
      allComplete: false,
      remainingCount: 0,
      completedTasks: [],
    })

    expect(notification).toContain(`**Error:** ${shortError}\n`)
    expect(notification).not.toContain("truncated")
  })
})
