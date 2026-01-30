import { describe, expect, it, mock, beforeEach } from "bun:test"

// Mock dependencies before importing
const mockInjectHookMessage = mock(() => true)
mock.module("../../features/hook-message-injector", () => ({
  injectHookMessage: mockInjectHookMessage,
}))

mock.module("../../shared/logger", () => ({
  log: () => {},
}))

mock.module("../../shared/system-directive", () => ({
  createSystemDirective: (type: string) => `[DIRECTIVE:${type}]`,
  SystemDirectiveTypes: {
    TODO_CONTINUATION: "TODO CONTINUATION",
    RALPH_LOOP: "RALPH LOOP",
    BOULDER_CONTINUATION: "BOULDER CONTINUATION",
    DELEGATION_REQUIRED: "DELEGATION REQUIRED",
    SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
    COMPACTION_CONTEXT: "COMPACTION CONTEXT",
    CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
    PROMETHEUS_READ_ONLY: "PROMETHEUS READ-ONLY",
  },
}))

import { createCompactionContextInjector } from "./index"
import type { SummarizeContext } from "./index"

describe("createCompactionContextInjector", () => {
  beforeEach(() => {
    mockInjectHookMessage.mockClear()
  })

  describe("Agent Verification State preservation", () => {
    it("includes Agent Verification State section in compaction prompt", async () => {
      // given
      const injector = createCompactionContextInjector()
      const context: SummarizeContext = {
        sessionID: "test-session",
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        usageRatio: 0.85,
        directory: "/test/dir",
      }

      // when
      await injector(context)

      // then
      expect(mockInjectHookMessage).toHaveBeenCalledTimes(1)
      const calls = mockInjectHookMessage.mock.calls as unknown as [string, string, unknown][]
      const injectedPrompt = calls[0]?.[1] ?? ""
      expect(injectedPrompt).toContain("Agent Verification State")
      expect(injectedPrompt).toContain("Current Agent")
      expect(injectedPrompt).toContain("Verification Progress")
    })

    it("includes Momus-specific context for reviewer agents", async () => {
      // given
      const injector = createCompactionContextInjector()
      const context: SummarizeContext = {
        sessionID: "test-session",
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        usageRatio: 0.9,
        directory: "/test/dir",
      }

      // when
      await injector(context)

      // then
      const calls = mockInjectHookMessage.mock.calls as unknown as [string, string, unknown][]
      const injectedPrompt = calls[0]?.[1] ?? ""
      expect(injectedPrompt).toContain("Previous Rejections")
      expect(injectedPrompt).toContain("Acceptance Status")
      expect(injectedPrompt).toContain("reviewer agents")
    })

    it("preserves file verification progress in compaction prompt", async () => {
      // given
      const injector = createCompactionContextInjector()
      const context: SummarizeContext = {
        sessionID: "test-session",
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        usageRatio: 0.95,
        directory: "/test/dir",
      }

      // when
      await injector(context)

      // then
      const calls = mockInjectHookMessage.mock.calls as unknown as [string, string, unknown][]
      const injectedPrompt = calls[0]?.[1] ?? ""
      expect(injectedPrompt).toContain("Pending Verifications")
      expect(injectedPrompt).toContain("Files already verified")
    })
  })
})
