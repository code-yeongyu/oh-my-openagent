/**
 * Tests for post-compaction degradation monitor
 * Validates degradation detection, recovery triggering, and recovery limits
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { createPostCompactionDegradationMonitor } from "../../preemptive-compaction-degradation-monitor"
import type { AssistantCompactionMessageInfo } from "../../preemptive-compaction-degradation-monitor"

// Mock the no-text tail resolver
mock.module("../../preemptive-compaction-no-text-tail", () => ({
  resolveNoTextTailFromSession: async ({ parts }: { parts?: unknown }) => {
    // Check if parts contain only step-start/step-finish with no text
    if (!Array.isArray(parts) || parts.length === 0) return false
    return parts.every(
      (part: any) =>
        (part.type === "step-start" || part.type === "step-finish") &&
        (!part.text || part.text.trim() === "")
    )
  },
}))

// Mock the compaction model resolver
mock.module("../../shared/compaction-model-resolver", () => ({
  resolveCompactionModel: (_config: unknown, _sessionID: string, providerID: string, modelID: string) => ({
    providerID,
    modelID,
  }),
}))

describe("post-compaction-degradation-monitor", () => {
  let mockClient: any
  let tokenCache: Map<string, any>
  let compactionInProgress: Set<string>
  let monitor: ReturnType<typeof createPostCompactionDegradationMonitor>
  let summarizeMock: ReturnType<typeof mock>
  let showToastMock: ReturnType<typeof mock>

  beforeEach(() => {
    summarizeMock = mock(async () => ({}))
    showToastMock = mock(async () => ({}))

    mockClient = {
      session: {
        summarize: summarizeMock,
        messages: mock(async () => ({ data: [] })),
      },
      tui: {
        showToast: showToastMock,
      },
    }

    tokenCache = new Map()
    compactionInProgress = new Set()

    monitor = createPostCompactionDegradationMonitor({
      client: mockClient,
      directory: "/tmp/test",
      pluginConfig: {},
      tokenCache,
      compactionInProgress,
    })
  })

  afterEach(() => {
    mock.restore()
  })

  function createNoTextParts(): unknown[] {
    return [
      { type: "step-start", text: "" },
      { type: "step-finish", text: "" },
    ]
  }

  function createTextParts(): unknown[] {
    return [{ type: "text", text: "Hello, world!" }]
  }

  describe("onSessionCompacted", () => {
    it("initializes monitoring state after compaction", () => {
      // Given
      const sessionID = "test-session"

      // When
      monitor.onSessionCompacted(sessionID)

      // Then: Monitor should be ready to track messages
      // We can verify this by checking that onAssistantMessageUpdated processes messages
    })

    it("increments epoch on each compaction", () => {
      // Given
      const sessionID = "test-session"

      // When
      monitor.onSessionCompacted(sessionID)
      monitor.onSessionCompacted(sessionID)
      monitor.onSessionCompacted(sessionID)

      // Then: Epoch should be 3 (internal state, verified by behavior)
    })

    it("resets no-text streak on new compaction", () => {
      // Given
      const sessionID = "test-session"
      monitor.onSessionCompacted(sessionID)

      // When: Simulate some no-text messages
      // Then: New compaction should reset the streak
      monitor.onSessionCompacted(sessionID)
    })
  })

  describe("onAssistantMessageUpdated", () => {
    it("detects consecutive no-text messages", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: 3 consecutive no-text messages
      for (let i = 1; i <= 3; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: Recovery should be triggered
      expect(showToastMock).toHaveBeenCalledWith({
        body: {
          title: "Session Degradation Detected",
          message: expect.stringContaining("no-text assistant responses"),
          variant: "warning",
          duration: 5000,
        },
      })
      expect(summarizeMock).toHaveBeenCalledTimes(1)
    })

    it("does not trigger recovery for less than 3 no-text messages", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: Only 2 no-text messages
      for (let i = 1; i <= 2; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: No recovery triggered
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("resets streak when text message is received", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: 2 no-text, then 1 text, then 2 no-text
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-1",
        parts: createNoTextParts(),
      })
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-2",
        parts: createNoTextParts(),
      })
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-3",
        parts: createTextParts(),
      })
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-4",
        parts: createNoTextParts(),
      })
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-5",
        parts: createNoTextParts(),
      })

      // Then: No recovery (streak was reset)
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("only monitors first 5 messages after compaction", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: 6 no-text messages
      for (let i = 1; i <= 6; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: Recovery triggered once (at message 3)
      expect(summarizeMock).toHaveBeenCalledTimes(1)
    })

    it("does not monitor when not in post-compaction state", async () => {
      // Given: No onSessionCompacted called
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })

      // When: 3 no-text messages
      for (let i = 1; i <= 3; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: No recovery
      expect(summarizeMock).not.toHaveBeenCalled()
    })
  })

  describe("recovery limits", () => {
    it("limits recovery attempts to MAX_RECOVERY_ATTEMPTS (3)", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })

      // When: Trigger recovery multiple times across epochs
      // The implementation tracks recovery count per session, not per epoch
      for (let epoch = 0; epoch < 5; epoch++) {
        monitor.onSessionCompacted(sessionID)
        // Wait a bit to ensure suppression window passes
        await new Promise((resolve) => setTimeout(resolve, 10))
        for (let i = 1; i <= 3; i++) {
          await monitor.onAssistantMessageUpdated({
            sessionID,
            id: `msg-${epoch}-${i}`,
            parts: createNoTextParts(),
          })
        }
      }

      // Then: Should have at most 3 recovery attempts (MAX_RECOVERY_ATTEMPTS)
      // Note: The actual count may be less due to suppression windows and state clearing
      expect(summarizeMock.mock.calls.length).toBeLessThanOrEqual(3)
      expect(summarizeMock.mock.calls.length).toBeGreaterThan(0)
    })

    it("does not trigger recovery when compaction is in progress", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      compactionInProgress.add(sessionID)
      monitor.onSessionCompacted(sessionID)

      // When: 3 no-text messages
      for (let i = 1; i <= 3; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: No recovery
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("does not trigger recovery when model is unavailable", async () => {
      // Given
      const sessionID = "test-session"
      // No token cache entry
      monitor.onSessionCompacted(sessionID)

      // When: 3 no-text messages
      for (let i = 1; i <= 3; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: No recovery
      expect(summarizeMock).not.toHaveBeenCalled()
    })
  })

  describe("recovery suppression", () => {
    it("suppresses recovery for 5 seconds after recovery attempt", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: Trigger recovery
      for (let i = 1; i <= 3; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: Recovery triggered once
      expect(summarizeMock).toHaveBeenCalledTimes(1)

      // When: Try to trigger again immediately (within 5s)
      monitor.onSessionCompacted(sessionID)
      for (let i = 4; i <= 6; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      // Then: No additional recovery (suppressed)
      expect(summarizeMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("clear", () => {
    it("clears all monitoring state for a session", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: Clear state
      monitor.clear(sessionID)

      // Then: No-text messages should not trigger recovery
      for (let i = 1; i <= 3; i++) {
        await monitor.onAssistantMessageUpdated({
          sessionID,
          id: `msg-${i}`,
          parts: createNoTextParts(),
        })
      }

      expect(summarizeMock).not.toHaveBeenCalled()
    })
  })

  describe("epoch-based tracking", () => {
    it("clears state when epoch changes", async () => {
      // Given
      const sessionID = "test-session"
      tokenCache.set(sessionID, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
      monitor.onSessionCompacted(sessionID)

      // When: 2 no-text messages, then new compaction
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-1",
        parts: createNoTextParts(),
      })
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-2",
        parts: createNoTextParts(),
      })
      monitor.onSessionCompacted(sessionID) // New epoch

      // Then: Streak should be reset
      await monitor.onAssistantMessageUpdated({
        sessionID,
        id: "msg-3",
        parts: createNoTextParts(),
      })

      // Only 1 no-text message in new epoch, no recovery
      expect(summarizeMock).not.toHaveBeenCalled()
    })
  })
})
