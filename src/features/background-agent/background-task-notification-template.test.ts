import { describe, expect, test } from "bun:test"
import { buildBackgroundTaskNotificationText } from "./background-task-notification-template"

describe("buildBackgroundTaskNotificationText", () => {
  describe("#given one task still running after a completed task notification", () => {
    test("#when building the partial notification #then it preserves the existing completed-task format", () => {
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

      // when
      const expectedNotification = `<system-reminder>
[BACKGROUND TASK COMPLETED]
**ID:** \`task-1\`
**Description:** Index repo
**Duration:** 42s

**1 task still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="task-1")\` to retrieve this result when ready.
</system-reminder>`

      // then
      expect(notification).toBe(expectedNotification)
    })
  })

  describe("#given one task still running after a failed task notification", () => {
    test("#when building the partial notification #then it preserves the existing failure format", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "task-2",
          description: "Summarize logs",
          status: "error",
          error: "Timed out",
        },
        duration: "3m 4s",
        statusText: "ERROR",
        allComplete: false,
        remainingCount: 2,
        completedTasks: [],
      })

      // when
      const expectedNotification = `<system-reminder>
[BACKGROUND TASK ERROR]
**ID:** \`task-2\`
**Description:** Summarize logs
**Duration:** 3m 4s
**Error:** Timed out

**2 tasks still in progress.** You WILL be notified when ALL complete.
**ACTION REQUIRED:** This task failed. Check the error and decide whether to retry, cancel remaining tasks, or continue.

Use \`background_output(task_id="task-2")\` to retrieve this result when ready.
</system-reminder>`

      // then
      expect(notification).toBe(expectedNotification)
    })
  })

  describe("#given all sibling tasks completed with mixed outcomes", () => {
    test("#when building the final notification #then it preserves the existing summary format", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "task-3",
          description: "Fallback task",
          status: "error",
          error: "Denied",
        },
        duration: "10s",
        statusText: "ERROR",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          {
            id: "task-1",
            description: "Index repo",
            status: "completed",
          },
          {
            id: "task-2",
            description: "Summarize logs",
            status: "cancelled",
            error: "User aborted",
          },
          {
            id: "task-3",
            description: "Fallback task",
            status: "error",
            error: "Denied",
          },
        ],
      })

      // when
      const expectedNotification = `<system-reminder>
[ALL BACKGROUND TASKS FINISHED - 2 FAILED]

**Completed:**
- \`task-1\`: Index repo

**Failed:**
- \`task-2\`: Summarize logs [CANCELLED] - User aborted
- \`task-3\`: Fallback task [ERROR] - Denied

Use \`background_output(task_id="<id>")\` to retrieve each result.

**ACTION REQUIRED:** 2 task(s) failed. Check errors above and decide whether to retry or proceed.
</system-reminder>`

      // then
      expect(notification).toBe(expectedNotification)
    })
  })

  describe("#given all tasks completed with undefined descriptions", () => {
    test("#when building the final notification #then it uses task ID as fallback instead of 'undefined'", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "bg_abc123",
          description: undefined as unknown as string,
          status: "completed",
        },
        duration: "5s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          { id: "bg_abc123", description: undefined as unknown as string, status: "completed" },
          { id: "bg_def456", description: undefined as unknown as string, status: "completed" },
        ],
      })

      // then
      expect(notification).not.toContain(": undefined")
      expect(notification).toContain("bg_abc123")
      expect(notification).toContain("bg_def456")
    })
  })

  describe("#given a completed task with retry attempt history", () => {
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
              modelId: "gpt-5.4-mini",
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
                modelId: "gpt-5.4-mini",
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
      expect(notification).toContain("  - Attempt 1 — ERROR — genai-proxy-openai/gpt-5.4-mini — ses-primary")
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
          description: undefined as unknown as string,
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
