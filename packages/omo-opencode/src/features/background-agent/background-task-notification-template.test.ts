import { describe, expect, test } from "bun:test"
import { buildBackgroundTaskNotificationText } from "./background-task-notification-template"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function headerLines(notification: string): string[] {
  return notification
    .split("\n")
    .slice(1)
    .filter((line) => /^\[[A-Z ]+[^\]]*\]$/.test(line))
}

function tag(notification: string, name: string): string | undefined {
  const match = notification.match(new RegExp(`<${name}>\\n?([\\s\\S]*?)\\n?</${name}>`))
  return match?.[1]
}

describe("buildBackgroundTaskNotificationText", () => {
  describe("#given a completed task while siblings still run", () => {
    test("#when building its notice #then it carries its own status header, id and result", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: { id: "bg_1", sessionId: "ses_1", description: "Index repo", status: "completed" },
        duration: "42s",
        statusText: "COMPLETED",
        allComplete: false,
        remainingCount: 1,
        result: { text: "found 3 call sites", truncated: false },
        usage: { toolCalls: 7 },
      })

      // then
      expect(headerLines(notification)).toEqual(["[BACKGROUND TASK COMPLETED]"])
      expect(tag(notification, "task-id")).toBe("bg_1")
      expect(tag(notification, "session-id")).toBe("ses_1")
      expect(tag(notification, "status")).toBe("completed")
      expect(tag(notification, "result")).toBe("found 3 call sites")
      expect(tag(notification, "usage")).toContain("tool calls: 7")
    })
  })

  describe("#given the last of the parent's tasks", () => {
    test("#when building its notice #then it adds the all-complete sentinel", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: { id: "bg_2", description: "Trace", status: "completed" },
        duration: "10s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
      })

      // then
      expect(headerLines(notification)).toEqual(["[BACKGROUND TASK COMPLETED]", "[ALL BACKGROUND TASKS COMPLETE]"])
      expect(tag(notification, "result")).toBeUndefined()
    })
  })

  describe("#given a failed task", () => {
    test("#when building its notice #then the failure header and error are present", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: { id: "bg_3", description: "Build", status: "error", error: "provider 500" },
        duration: "3s",
        statusText: "ERROR",
        allComplete: true,
        remainingCount: 0,
      })

      // then
      expect(headerLines(notification)[0]).toBe("[BACKGROUND TASK ERROR]")
      expect(tag(notification, "status")).toBe("error")
      expect(tag(notification, "error")).toBe("provider 500")
    })
  })

  describe("#given a truncated result", () => {
    test("#when building its notice #then it points at background_output for the rest", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: { id: "bg_4", description: "Long", status: "completed" },
        duration: "1m",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        result: { text: "partial", truncated: true },
      })

      // then
      expect(notification).toContain('background_output(task_id="bg_4")')
    })
  })

  describe("#given an undefined description", () => {
    test("#when building its notice #then the summary uses the task id", () => {
      // given
      const notification = buildBackgroundTaskNotificationText({
        task: { id: "bg_xyz789", description: unsafeTestValue<string>(undefined), status: "completed" },
        duration: "3s",
        statusText: "COMPLETED",
        allComplete: false,
        remainingCount: 2,
      })

      // then
      expect(notification).not.toContain("undefined")
      expect(tag(notification, "summary")).toContain("bg_xyz789")
    })
  })

  describe("#given retry attempt history", () => {
    test("#when building its notice #then every attempt is listed with model and session", () => {
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
              error: "Forbidden",
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
      })

      // then
      expect(notification).toContain("  - Attempt 1: ERROR - genai-proxy-openai/gpt-5.6-luna-fast - ses-primary")
      expect(notification).toContain("    Error: Forbidden")
      expect(notification).toContain("  - Attempt 2: COMPLETED - anthropic/claude-haiku-4.5 - ses-fallback")
    })
  })
})
