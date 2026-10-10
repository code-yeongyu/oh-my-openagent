import { describe, expect, test } from "bun:test"
import {
  buildBackgroundTaskNotificationText,
  type BackgroundTaskNotificationTask,
} from "./background-task-notification-template"

const MAX_EMBEDDED_ERROR_LENGTH = 2_000
const LARGE_PROVIDER_ERROR_LENGTH = 513_039
const LARGE_PROVIDER_ERROR_TAIL = "[UNIQUE_PROVIDER_ERROR_TAIL]"
const LARGE_PROVIDER_ERROR_MARKER = `[truncated from ${LARGE_PROVIDER_ERROR_LENGTH} characters]`

function createLargeProviderError(): string {
  const prefix = "Forbidden: Selected provider is forbidden. "
  const paddingLength = LARGE_PROVIDER_ERROR_LENGTH - prefix.length - LARGE_PROVIDER_ERROR_TAIL.length
  return `${prefix}${"x".repeat(paddingLength)}${LARGE_PROVIDER_ERROR_TAIL}`
}

function extractNotificationLineValue(notification: string, prefix: string): string {
  const line = notification.split("\n").find((candidate) => candidate.startsWith(prefix))
  if (!line) {
    throw new Error(`Expected notification line starting with ${prefix}`)
  }

  return line.slice(prefix.length)
}

describe("background task notification errors", () => {
  describe("#given a partial failed-task notification", () => {
    test("#when the task has a short error #then it preserves the error byte-for-byte", () => {
      // given
      const error = "Forbidden: Selected provider is forbidden"

      // when
      const notification = buildBackgroundTaskNotificationText({
        task: {
          id: "task-short-error",
          description: "Fallback task",
          status: "error",
          error,
        },
        duration: "4s",
        statusText: "ERROR",
        allComplete: false,
        remainingCount: 1,
        completedTasks: [],
      })

      // then
      const renderedError = extractNotificationLineValue(notification, "**Error:** ")
      expect(renderedError).toBe(error)
    })

    test("#when the task has a 513039-character provider error #then it bounds only the notification copy", () => {
      // given
      const error = createLargeProviderError()
      const task = {
        id: "task-large-partial-error",
        description: "Fallback task",
        status: "error",
        error,
      } satisfies BackgroundTaskNotificationTask

      // when
      const notification = buildBackgroundTaskNotificationText({
        task,
        duration: "4s",
        statusText: "ERROR",
        allComplete: false,
        remainingCount: 1,
        completedTasks: [],
      })

      // then
      const renderedError = extractNotificationLineValue(notification, "**Error:** ")
      expect(renderedError.length).toBeLessThanOrEqual(MAX_EMBEDDED_ERROR_LENGTH)
      expect(renderedError.startsWith("Forbidden: Selected provider is forbidden.")).toBe(true)
      expect(renderedError.includes(LARGE_PROVIDER_ERROR_MARKER)).toBe(true)
      expect(renderedError.includes(LARGE_PROVIDER_ERROR_TAIL)).toBe(false)
      expect(task.error.length).toBe(LARGE_PROVIDER_ERROR_LENGTH)
      expect(task.error.endsWith(LARGE_PROVIDER_ERROR_TAIL)).toBe(true)
    })
  })

  describe("#given a final notification with a failed task", () => {
    test("#when the task has a 513039-character provider error #then the final summary embeds a bounded copy", () => {
      // given
      const error = createLargeProviderError()
      const failedTask = {
        id: "task-large-final-error",
        description: "Fallback task",
        status: "error",
        error,
      } satisfies BackgroundTaskNotificationTask

      // when
      const notification = buildBackgroundTaskNotificationText({
        task: failedTask,
        duration: "4s",
        statusText: "ERROR",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [
          { id: "task-completed", description: "Index repo", status: "completed" },
          failedTask,
        ],
      })

      // then
      const summaryPrefix = `- \`${failedTask.id}\`: ${failedTask.description} [ERROR] - `
      const renderedError = extractNotificationLineValue(notification, summaryPrefix)
      expect(renderedError.length).toBeLessThanOrEqual(MAX_EMBEDDED_ERROR_LENGTH)
      expect(renderedError.includes(LARGE_PROVIDER_ERROR_MARKER)).toBe(true)
      expect(renderedError.includes(LARGE_PROVIDER_ERROR_TAIL)).toBe(false)
      expect(failedTask.error.length).toBe(LARGE_PROVIDER_ERROR_LENGTH)
      expect(failedTask.error.endsWith(LARGE_PROVIDER_ERROR_TAIL)).toBe(true)
    })
  })

  describe("#given a completed task with retry attempt history", () => {
    test("#when a failed attempt has a 513039-character provider error #then the attempt timeline embeds a bounded copy", () => {
      // given
      const error = createLargeProviderError()
      const task = {
        id: "task-large-attempt-error",
        description: "Fallback task",
        status: "completed",
        attempts: [
          {
            attemptId: "att-large-error",
            attemptNumber: 1,
            sessionId: "ses-primary",
            providerId: "genai-proxy-openai",
            modelId: "gpt-5.6-luna-fast",
            status: "error",
            error,
          },
          {
            attemptId: "att-large-success",
            attemptNumber: 2,
            sessionId: "ses-fallback",
            providerId: "anthropic",
            modelId: "claude-haiku-4.5",
            status: "completed",
          },
        ],
      } satisfies BackgroundTaskNotificationTask

      // when
      const notification = buildBackgroundTaskNotificationText({
        task,
        duration: "10s",
        statusText: "COMPLETED",
        allComplete: true,
        remainingCount: 0,
        completedTasks: [task],
      })

      // then
      const renderedError = extractNotificationLineValue(notification, "    Error: ")
      expect(renderedError.length).toBeLessThanOrEqual(MAX_EMBEDDED_ERROR_LENGTH)
      expect(renderedError.includes(LARGE_PROVIDER_ERROR_MARKER)).toBe(true)
      expect(renderedError.includes(LARGE_PROVIDER_ERROR_TAIL)).toBe(false)
      expect(task.attempts[0]?.error?.length).toBe(LARGE_PROVIDER_ERROR_LENGTH)
      expect(task.attempts[0]?.error?.endsWith(LARGE_PROVIDER_ERROR_TAIL)).toBe(true)
    })
  })
})
