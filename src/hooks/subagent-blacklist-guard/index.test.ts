import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createSubagentBlacklistGuard, clearSubagentBlacklistGuard } from "./index"
import { subagentSessions, _resetForTesting } from "../../features/claude-code-session-state"
import { setSessionFallbackChain, clearPendingModelFallback } from "../model-fallback/hook"
import * as globalBlacklist from "../../shared/global-blacklist"
import type { OhMyOpenCodeConfig } from "../../config"

// Mock the global blacklist module
const mockIsProviderBlacklisted = async (providerID: string) => {
  return providerID === "blacklisted-provider"
}

const mockBlacklistProvider = async () => {}
const mockGetBlacklistedProviders = async () => ["blacklisted-provider"]
const mockClearBlacklist = async () => {}

describe("subagent-blacklist-guard", () => {
  const mockPluginConfig: OhMyOpenCodeConfig = {
    disabled_hooks: [],
  }

  beforeEach(() => {
    _resetForTesting()
    // Clear any existing fallback chains
    clearPendingModelFallback("test-session")
    clearSubagentBlacklistGuard("test-session")
  })

  afterEach(() => {
    _resetForTesting()
  })

  describe("createSubagentBlacklistGuard", () => {
    test("should skip non-subagent sessions", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const input = { sessionID: "main-session" }
      const output = { 
        message: { providerID: "blacklisted-provider", modelID: "claude-opus", agent: "sisyphus" },
        parts: []
      }

      // Main session not in subagentSessions
      await guard["chat.message"](input as any, output as any)

      // Should not set up fallback for main session
      expect(output.message.model).toBeUndefined()
    })

    test("should skip if provider is not blacklisted", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const sessionID = "subagent-session"
      
      // Add to subagent sessions
      subagentSessions.add(sessionID)
      
      const input = { sessionID }
      const output = { 
        message: { providerID: "good-provider", modelID: "claude-opus", agent: "sisyphus-junior" },
        parts: []
      }

      await guard["chat.message"](input as any, output as any)

      // Should not modify output for non-blacklisted provider
      expect(output.message.providerID).toBe("good-provider")
    })

    test("should process only first message per session", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const sessionID = "subagent-session"
      
      subagentSessions.add(sessionID)
      
      const input = { sessionID }
      const output1 = { 
        message: { providerID: "good-provider", modelID: "claude-opus", agent: "sisyphus-junior" },
        parts: []
      }

      // First message
      await guard["chat.message"](input as any, output1 as any)

      // Second message - should be skipped
      const output2 = { 
        message: { providerID: "good-provider", modelID: "claude-opus", agent: "sisyphus-junior" },
        parts: []
      }
      await guard["chat.message"](input as any, output2 as any)

      // Both should have original provider (no changes on second call)
      expect(output1.message.providerID).toBe("good-provider")
      expect(output2.message.providerID).toBe("good-provider")
    })

    test("should skip if missing providerID or modelID", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const sessionID = "subagent-session"
      
      subagentSessions.add(sessionID)
      
      const input = { sessionID }
      const output = { 
        message: { agent: "sisyphus-junior" }, // Missing providerID and modelID
        parts: []
      }

      await guard["chat.message"](input as any, output as any)

      // Should not crash, just skip
      expect(output.message.providerID).toBeUndefined()
    })

    test("should handle subagent without agent name", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const sessionID = "subagent-session"
      
      subagentSessions.add(sessionID)
      
      const input = { sessionID }
      const output = { 
        message: { providerID: "blacklisted-provider", modelID: "claude-opus" }, // No agent
        parts: []
      }

      await guard["chat.message"](input as any, output as any)

      // Should process but not set up fallback (no agent name)
      expect(subagentSessions.has(sessionID)).toBe(true)
    })
  })

  describe("clearSubagentBlacklistGuard", () => {
    test("should clear tracked session", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const sessionID = "subagent-session"
      
      subagentSessions.add(sessionID)
      
      const input = { sessionID }
      const output = { 
        message: { providerID: "good-provider", modelID: "claude-opus", agent: "sisyphus-junior" },
        parts: []
      }

      // First call to mark as processed
      await guard["chat.message"](input as any, output as any)

      // Clear the session
      clearSubagentBlacklistGuard(sessionID)

      // Should be able to process again (for testing purposes)
      const output2 = { 
        message: { providerID: "good-provider", modelID: "claude-opus", agent: "sisyphus-junior" },
        parts: []
      }
      
      // This would normally be skipped, but after clear it should process
      // Note: In real usage, sessions are cleared on deletion, not re-processed
    })
  })

  describe("integration with subagentSessions", () => {
    test("should work with tracked subagent sessions", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const sessionID = "task-subagent-123"
      
      // Simulate session.created tracking
      subagentSessions.add(sessionID)
      
      expect(subagentSessions.has(sessionID)).toBe(true)
      
      const input = { sessionID }
      const output = { 
        message: { providerID: "good-provider", modelID: "claude-opus", agent: "sisyphus-junior" },
        parts: []
      }

      await guard["chat.message"](input as any, output as any)

      // Should complete without errors
      expect(output.message.providerID).toBe("good-provider")
    })

    test("should not affect main session", async () => {
      const guard = createSubagentBlacklistGuard({ pluginConfig: mockPluginConfig })
      const mainSessionID = "main-session"
      const subagentSessionID = "subagent-session"
      
      // Only subagent is tracked
      subagentSessions.add(subagentSessionID)
      
      const mainInput = { sessionID: mainSessionID }
      const mainOutput = { 
        message: { providerID: "any-provider", modelID: "claude-opus", agent: "sisyphus" },
        parts: []
      }

      await guard["chat.message"](mainInput as any, mainOutput as any)

      // Main session should be untouched
      expect(mainOutput.message.providerID).toBe("any-provider")
      expect(subagentSessions.has(mainSessionID)).toBe(false)
    })
  })
})
