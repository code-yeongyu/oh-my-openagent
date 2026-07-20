/**
 * Tests for preemptive compaction trigger
 * Validates threshold triggering, cooldown protection, timeout handling, and concurrent protection
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { runPreemptiveCompactionIfNeeded } from "../../preemptive-compaction-trigger"
import type { CachedCompactionState, PreemptiveCompactionContext } from "../../preemptive-compaction-types"
import type { OhMyOpenCodeConfig } from "../../../config"

// Mock the context limit resolver
mock.module("../../../shared/context-limit-resolver", () => ({
  resolveActualContextLimit: (providerID: string, modelID: string, _state?: unknown) => {
    const limits: Record<string, number> = {
      "anthropic/claude-3-5-sonnet": 200000,
      "anthropic/claude-3-opus": 200000,
      "openai/gpt-4o": 128000,
      "openai/gpt-4o-mini": 128000,
    }
    return limits[`${providerID}/${modelID}`] ?? null
  },
}))

// Mock the compaction model resolver
mock.module("../../shared/compaction-model-resolver", () => ({
  resolveCompactionModel: (_config: unknown, _sessionID: string, providerID: string, modelID: string) => ({
    providerID,
    modelID,
  }),
}))

describe("preemptive-compaction-trigger", () => {
  let mockContext: PreemptiveCompactionContext
  let mockPluginConfig: OhMyOpenCodeConfig
  let tokenCache: Map<string, CachedCompactionState>
  let compactionInProgress: Set<string>
  let compactedSessions: Set<string>
  let lastCompactionTime: Map<string, number>
  let summarizeMock: ReturnType<typeof mock>
  let showToastMock: ReturnType<typeof mock>

  beforeEach(() => {
    summarizeMock = mock(async () => ({}))
    showToastMock = mock(async () => ({}))

    mockContext = {
      client: {
        session: {
          messages: mock(async () => ({ data: [] })),
          summarize: summarizeMock,
        },
        tui: {
          showToast: showToastMock,
        },
      },
      directory: "/tmp/test",
    }

    mockPluginConfig = {} as OhMyOpenCodeConfig
    tokenCache = new Map()
    compactionInProgress = new Set()
    compactedSessions = new Set()
    lastCompactionTime = new Map()
  })

  afterEach(() => {
    mock.restore()
  })

  function createCachedState(
    providerID: string,
    modelID: string,
    inputTokens: number,
    cacheReadTokens: number = 0
  ): CachedCompactionState {
    return {
      providerID,
      modelID,
      tokens: {
        input: inputTokens,
        output: 0,
        reasoning: 0,
        cache: { read: cacheReadTokens, write: 0 },
      },
    }
  }

  describe("threshold trigger", () => {
    it("triggers compaction when usage ratio reaches 78%", async () => {
      // Given: 200k context limit, 156k tokens = 78%
      const sessionID = "test-session-threshold"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).toHaveBeenCalledTimes(1)
      expect(summarizeMock).toHaveBeenCalledWith({
        path: { id: sessionID },
        body: {
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          auto: true,
        },
        query: { directory: "/tmp/test" },
      })
    })

    it("does not trigger compaction when usage ratio is below 78%", async () => {
      // Given: 200k context limit, 150k tokens = 75%
      const sessionID = "test-session-below-threshold"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 150000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("triggers compaction when usage ratio is above 78%", async () => {
      // Given: 200k context limit, 170k tokens = 85%
      const sessionID = "test-session-above-threshold"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 170000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).toHaveBeenCalledTimes(1)
    })

    it("includes cache read tokens in usage calculation", async () => {
      // Given: 200k context limit, 100k input + 56k cache read = 156k total = 78%
      const sessionID = "test-session-cache-tokens"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 100000, 56000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).toHaveBeenCalledTimes(1)
    })

    it("does not trigger when context limit is unknown", async () => {
      // Given: Unknown model
      const sessionID = "test-session-unknown-model"
      tokenCache.set(sessionID, createCachedState("unknown", "unknown-model", 156000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("does not trigger when session has no cached state", async () => {
      // Given: No token cache entry
      const sessionID = "test-session-no-cache"

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).not.toHaveBeenCalled()
    })
  })

  describe("cooldown period", () => {
    it("skips compaction during cooldown period", async () => {
      // Given: Recent compaction
      const sessionID = "test-session-cooldown"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))
      lastCompactionTime.set(sessionID, Date.now() - 30000) // 30 seconds ago

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("allows compaction after cooldown period", async () => {
      // Given: Compaction more than 60 seconds ago
      const sessionID = "test-session-after-cooldown"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))
      lastCompactionTime.set(sessionID, Date.now() - 61000) // 61 seconds ago

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).toHaveBeenCalledTimes(1)
    })

    it("updates lastCompactionTime after successful compaction", async () => {
      // Given
      const sessionID = "test-session-update-time"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(lastCompactionTime.has(sessionID)).toBe(true)
      const lastTime = lastCompactionTime.get(sessionID)
      expect(lastTime).toBeGreaterThan(Date.now() - 1000)
    })
  })

  describe("concurrent compaction protection", () => {
    it("skips compaction when already in progress", async () => {
      // Given: Compaction already in progress
      const sessionID = "test-session-concurrent"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))
      compactionInProgress.add(sessionID)

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("removes session from compactionInProgress after completion", async () => {
      // Given
      const sessionID = "test-session-cleanup"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(compactionInProgress.has(sessionID)).toBe(false)
    })

    it("removes session from compactionInProgress after failure", async () => {
      // Given: Summarize will fail
      const sessionID = "test-session-failure-cleanup"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))
      summarizeMock.mockRejectedValueOnce(new Error("Summarize failed"))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(compactionInProgress.has(sessionID)).toBe(false)
    })
  })

  describe("compacted sessions tracking", () => {
    it("skips compaction for already compacted sessions", async () => {
      // Given: Session already compacted
      const sessionID = "test-session-already-compacted"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))
      compactedSessions.add(sessionID)

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(summarizeMock).not.toHaveBeenCalled()
    })

    it("adds session to compactedSessions after successful compaction", async () => {
      // Given
      const sessionID = "test-session-mark-compacted"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(compactedSessions.has(sessionID)).toBe(true)
    })
  })

  describe("timeout handling", () => {
    it("shows toast when compaction fails", async () => {
      // Given: Summarize will fail
      const sessionID = "test-session-failure-toast"
      tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))
      summarizeMock.mockRejectedValueOnce(new Error("Summarize failed"))

      // When
      await runPreemptiveCompactionIfNeeded({
        ctx: mockContext,
        pluginConfig: mockPluginConfig,
        sessionID,
        tokenCache,
        compactionInProgress,
        compactedSessions,
        lastCompactionTime,
      })

      // Then
      expect(showToastMock).toHaveBeenCalledTimes(1)
      expect(showToastMock).toHaveBeenCalledWith({
        body: {
          title: "Preemptive compaction failed",
          message: expect.stringContaining("78%"),
          variant: "warning",
          duration: 10000,
        },
      })
    })
  })
})
