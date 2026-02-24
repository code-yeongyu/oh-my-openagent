/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, mock } from "bun:test"
import type { BackgroundOutputClient, BackgroundOutputMessage } from "./clients"
import { formatFullSession } from "./full-session-format"
import type { BackgroundTask } from "../../features/background-agent"

describe("formatFullSession", () => {
  let mockClient: BackgroundOutputClient
  let mockTask: BackgroundTask

  beforeEach(() => {
    mockTask = {
      id: "task-123",
      sessionID: "session-456",
      description: "Test task",
      status: "running",
      agent: "explore",
      prompt: "Test prompt",
    } as BackgroundTask

    mockClient = {
      session: {
        messages: mock(() => Promise.resolve([])),
      },
    }
  })

  describe("#given task has no sessionID", () => {
    describe("#when formatting full session", () => {
      test("#then returns task status", async () => {
        const task = { ...mockTask, sessionID: undefined } as BackgroundTask

        const result = await formatFullSession(task, mockClient, {
          includeThinking: false,
          includeToolResults: false,
        })

        expect(result).toContain("Task ID")
        expect(result).toContain("task-123")
        expect(result).not.toContain("## Messages")
      })
    })
  })

  describe("#given messages fetch returns error", () => {
    describe("#when formatting full session", () => {
      test("#then returns error message", async () => {
        mockClient.session.messages = mock(() =>
          Promise.resolve({ error: "Failed to fetch" }),
        )

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
        })

        expect(result).toBe("Error fetching messages: Failed to fetch")
      })
    })
  })

  describe("#given no messages found", () => {
    describe("#when formatting full session", () => {
      test("#then returns no messages message", async () => {
        mockClient.session.messages = mock(() => Promise.resolve([]))

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
        })

        expect(result).toContain("(No messages found)")
        expect(result).toContain("Task ID: task-123")
      })
    })
  })

  describe("#given compression is disabled", () => {
    describe("#when output exceeds threshold", () => {
      test("#then uses regular format without compression", async () => {
        const largeText = "x".repeat(6000)
        const messages: BackgroundOutputMessage[] = [
          {
            id: "msg-1",
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: largeText }],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
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
            id: "msg-1",
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: smallText }],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
          compressionConfig: { enabled: true, threshold: 5000 },
        })

        expect(result).not.toContain("[Compressed output]")
        expect(result).toContain(smallText)
      })
    })

    describe("#when output exceeds threshold with uniform messages", () => {
      test("#then uses compressed format", async () => {
        // Create 5+ uniform messages that exceed threshold
        const messages: BackgroundOutputMessage[] = Array.from(
          { length: 6 },
          (_, i) => ({
            id: `msg-${i}`,
            info: { role: "assistant", time: `2026-01-01T10:0${i}:00Z` },
            parts: [
              { type: "text", text: `Content ${i}: ${"x".repeat(1000)}` },
            ],
          }),
        )
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
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
      test("#then does not compress error message for fetch failure", async () => {
        mockClient.session.messages = mock(() =>
          Promise.resolve({ error: "Network error" }),
        )

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
          compressionConfig: { enabled: true, threshold: 1 },
        })

        expect(result).toBe("Error fetching messages: Network error")
        expect(result).not.toContain("[Compressed output]")
      })
    })
  })

  describe("#given default compression config", () => {
    describe("#when no compression config provided", () => {
      test("#then uses disabled compression by default", async () => {
        const largeText = "x".repeat(6000)
        const messages: BackgroundOutputMessage[] = [
          {
            id: "msg-1",
            info: { role: "assistant", time: "2026-01-01T10:01:00Z" },
            parts: [{ type: "text", text: largeText }],
          },
        ]
        mockClient.session.messages = mock(() => Promise.resolve(messages))

        const result = await formatFullSession(mockTask, mockClient, {
          includeThinking: false,
          includeToolResults: false,
        })

        expect(result).not.toContain("[Compressed output]")
        expect(result).toContain(largeText)
      })
    })
  })
})
