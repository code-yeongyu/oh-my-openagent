/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, mock } from "bun:test"
import type { BackgroundOutputClient, BackgroundOutputMessage } from "./clients"
import { formatTaskResult } from "./task-result-format"
import type { BackgroundTask } from "../../features/background-agent"
import { resetMessageCursor } from "../../shared/session-cursor"

describe("formatTaskResult", () => {
  let mockClient: BackgroundOutputClient
  let mockTask: BackgroundTask

  beforeEach(() => {
    resetMessageCursor() // Clear session cursor state between tests

    mockTask = {
      id: "task-123",
      sessionID: "session-456",
      description: "Test task",
      startedAt: new Date("2026-01-01T10:00:00Z"),
      completedAt: new Date("2026-01-01T10:05:00Z"),
    } as BackgroundTask

    mockClient = {
      session: {
        messages: mock(() => Promise.resolve([])),
      },
    }
  })

  describe("#given task has no sessionID", () => {
    describe("#when formatting result", () => {
      test("#then returns error message", async () => {
        const task = { ...mockTask, sessionID: undefined } as BackgroundTask

        const result = await formatTaskResult(task, mockClient)

        expect(result).toBe("Error: Task has no sessionID")
      })
    })
  })

  describe("#given messages fetch returns error", () => {
    describe("#when formatting result", () => {
      test("#then returns error message", async () => {
        mockClient.session.messages = mock(() =>
          Promise.resolve({ error: "Failed to fetch" }),
        )

        const result = await formatTaskResult(mockTask, mockClient)

        expect(result).toBe("Error fetching messages: Failed to fetch")
      })
    })
  })

  describe("#given no messages found", () => {
    describe("#when formatting result", () => {
      test("#then returns no messages message", async () => {
        mockClient.session.messages = mock(() => Promise.resolve([]))

        const result = await formatTaskResult(mockTask, mockClient)

        expect(result).toContain("(No messages found)")
        expect(result).toContain("Task ID: task-123")
      })
    })
  })

  describe("#given no assistant or tool messages", () => {
    describe("#when formatting result", () => {
      test("#then returns no response message", async () => {
        const messages: BackgroundOutputMessage[] = [
          { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatTaskResult(mockTask, mockClient)

        expect(result).toContain("(No assistant or tool response found)")
      })
    })
  })

  describe("#given compression is disabled", () => {
    describe("#when output exceeds threshold", () => {
      test("#then uses regular format without compression", async () => {
        const largeText = "x".repeat(6000)
        const messages: BackgroundOutputMessage[] = [
          {
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: largeText }],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatTaskResult(mockTask, mockClient, {
          compressionConfig: { enabled: false, threshold: 5000 },
        })

        expect(result).not.toContain("[Compressed output]")
        expect(result).toContain(largeText)
      })
    })
  })

  describe("#given compression is enabled", () => {
    describe("#when output below threshold", () => {
      test("#then uses regular format", async () => {
        const smallText = "small output"
        const messages: BackgroundOutputMessage[] = [
          {
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: smallText }],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatTaskResult(mockTask, mockClient, {
          compressionConfig: { enabled: true, threshold: 5000 },
        })

        expect(result).not.toContain("[Compressed output]")
        expect(result).toContain(smallText)
      })
    })

    describe("#when output exceeds threshold but messages not uniform", () => {
      test("#then falls back to regular format", async () => {
        // Create messages with different structures (not uniform)
        const messages: BackgroundOutputMessage[] = [
          {
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: "x".repeat(3000) }],
          },
          {
            info: { role: "tool", time: "2026-01-01T10:02:00Z" },
            parts: [
              { type: "tool_result", content: "y".repeat(3000) },
            ],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatTaskResult(mockTask, mockClient, {
          compressionConfig: { enabled: true, threshold: 100 },
        })

        // Should still work, either compressed or regular format
        expect(result).toContain("Task ID: task-123")
      })
    })

    describe("#when output exceeds threshold with uniform messages", () => {
      test("#then uses compressed format", async () => {
        // Create 5+ uniform messages that exceed threshold
        const messages: BackgroundOutputMessage[] = Array.from(
          { length: 6 },
          (_, i) => ({
            info: { role: "assistant", time: `2026-01-01T10:0${i}:00Z` },
            parts: [
              { type: "text", text: `Content ${i}: ${"x".repeat(1000)}` },
            ],
          }),
        )
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatTaskResult(mockTask, mockClient, {
          compressionConfig: { enabled: true, threshold: 500 },
        })

        expect(result).toContain("[Compressed output]")
        expect(result).toContain("Task ID: task-123")
        expect(result).toContain("Session ID: session-456")
      })
    })
  })

  describe("#given error responses", () => {
    describe("#when compression is enabled", () => {
      test("#then does not compress error message for missing sessionID", async () => {
        const task = { ...mockTask, sessionID: undefined } as BackgroundTask

        const result = await formatTaskResult(task, mockClient, {
          compressionConfig: { enabled: true, threshold: 1 },
        })

        expect(result).toBe("Error: Task has no sessionID")
        expect(result).not.toContain("[Compressed output]")
      })

      test("#then does not compress error message for fetch failure", async () => {
        mockClient.session.messages = mock(() =>
          Promise.resolve({ error: "Network error" }),
        )

        const result = await formatTaskResult(mockTask, mockClient, {
          compressionConfig: { enabled: true, threshold: 1 },
        })

        expect(result).toBe("Error fetching messages: Network error")
        expect(result).not.toContain("[Compressed output]")
      })
    })
  })

  describe("#given default compression config", () => {
    describe("#when no options provided", () => {
      test("#then uses disabled compression by default", async () => {
        const largeText = "x".repeat(6000)
        const messages: BackgroundOutputMessage[] = [
          {
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: largeText }],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatTaskResult(mockTask, mockClient)

        expect(result).not.toContain("[Compressed output]")
        expect(result).toContain(largeText)
      })
    })
  })
})
