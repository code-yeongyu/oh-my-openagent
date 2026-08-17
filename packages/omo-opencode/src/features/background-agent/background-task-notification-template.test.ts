// allow: SIZE_OK - notification template tests cover one rendering contract with shared cases; this release adds narrow status cases and future additions should split by template section.

import { describe, expect, test } from "bun:test"
import { buildBackgroundTaskNotificationText } from "./background-task-notification-template"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("buildBackgroundTaskNotificationText", () => {
  describe("#given one task still running after a completed task notification", () => {
    test("#when building the partial notification #then it does not use the final completed heading", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "task-1",
          description: "Index repo",
          status: "completed",
        },
        duration: "42s",
        statusText: "COMPLETED",
        allComplete: false,
        remainingCount: 1,
        completedTasks: [],
      })

      // then
      expect(notification).not.toContain("[BACKGROUND TASK COMPLETED]")
      expect(notification).toContain("[BACKGROUND TASK RESULT READY]")
      expect(notification).toContain("You WILL be notified when ALL complete.")
    })

  })

  describe("#given one task still running after a failed task notification", () => {
  })

  describe("#given all sibling tasks completed with mixed outcomes", () => {
  })

  describe("#given all tasks completed with undefined descriptions", () => {
    test("#when building the final notification #then it uses task ID as fallback instead of 'undefined'", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "bg_abc123",
          description: unsafeTestValue<string>(undefined),
          status: "completed",
        },
        duration: "5s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          { id: "bg_abc123", description: unsafeTestValue<string>(undefined), status: "completed" },
          { id: "bg_def456", description: unsafeTestValue<string>(undefined), status: "completed" },
        ],
      })

      // then
      expect(notification).not.toContain(": undefined")
      expect(notification).toContain("bg_abc123")
      expect(notification).toContain("bg_def456")
    })
  })

  describe("#given a completed task with retry attempt history", () => {
    test("#when building the final notification #then it includes the final completed heading", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "task-3",
          description: "Fallback task",
          status: "completed",
        },
        duration: "10s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          {
            id: "task-3",
            description: "Fallback task",
            status: "completed",
          },
        ],
      })

      // then
      expect(notification).toContain("[BACKGROUND TASK COMPLETED]")
      expect(notification).toContain("[ALL BACKGROUND TASKS COMPLETE]")
    })

    test("#when building the final notification #then it tells the agent to collect outputs immediately", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "bg_task_1",
          description: "Trace repo",
          status: "completed",
        },
        duration: "10s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          {
            id: "bg_task_1",
            description: "Trace repo",
            status: "completed",
          },
        ],
      })

      // then
      expect(notification).toContain("All sibling background tasks are complete.")
      expect(notification).not.toContain("Wait for the all-complete notification")
    })

    test("#when building the final notification #then it renders the spec-aligned balanced attempt timeline", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "task-3",
          description: "Fallback task",
          status: "completed",
          attempts: [
            {
              attemptId: "att-1",
              attemptNumber: 1,
              sessionId: "ses-primary",
              providerId: "genai-proxy-openai",
              modelId: "gpt-5.6-luna-fast",
              status: "error",
              error: "Forbidden: Selected provider is forbidden",
            },
            {
              attemptId: "att-2",
              attemptNumber: 2,
              sessionId: "ses-fallback",
              providerId: "anthropic",
              modelId: "claude-haiku-4.5",
              status: "completed",
            },
          ],
        },
        duration: "10s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          {
            id: "task-3",
            description: "Fallback task",
            status: "completed",
            attempts: [
              {
                attemptId: "att-1",
                attemptNumber: 1,
                sessionId: "ses-primary",
                providerId: "genai-proxy-openai",
                modelId: "gpt-5.6-luna-fast",
                status: "error",
                error: "Forbidden: Selected provider is forbidden",
              },
              {
                attemptId: "att-2",
                attemptNumber: 2,
                sessionId: "ses-fallback",
                providerId: "anthropic",
                modelId: "claude-haiku-4.5",
                status: "completed",
              },
            ],
          },
        ],
      })

      // then
      expect(notification).toContain("[ALL BACKGROUND TASKS COMPLETE]")
      expect(notification).toContain("- `task-3`: Fallback task")
      expect(notification).toContain("Background task attempts:")
      expect(notification).toContain("  - Attempt 1 — ERROR — genai-proxy-openai/gpt-5.6-luna-fast — ses-primary")
      expect(notification).toContain("    Error: Forbidden: Selected provider is forbidden")
      expect(notification).toContain("  - Attempt 2 — COMPLETED — anthropic/claude-haiku-4.5 — ses-fallback")
    })
  })

  describe("#given a single task notification with undefined description", () => {
    test("#when building the partial notification #then it uses task ID as fallback", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "bg_xyz789",
          description: unsafeTestValue<string>(undefined),
          status: "completed",
        },
        duration: "3s",
        statusText: "COMPLETED",
        allComplete: false,
        remainingCount: 2,
        completedTasks: [],
      })

      // then
      expect(notification).not.toContain("undefined")
      expect(notification).toContain("bg_xyz789")
    })
  })
})
