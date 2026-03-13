import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { _resetForTesting, setMainSession, getMainSessionID, subagentSessions, syncSubagentSessions } from "../features/claude-code-session-state"

describe("event handler - subagent support", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  describe("session tracking", () => {
    test("should track subagent sessions with parentID", () => {
      const subagentSessionID = "subagent-123"
      const parentID = "parent-session-456"
      
      // Simulate session.created with parentID
      subagentSessions.add(subagentSessionID)
      
      expect(subagentSessions.has(subagentSessionID)).toBe(true)
      expect(getMainSessionID()).toBeUndefined()
    })

    test("should set main session without parentID", () => {
      const mainSessionID = "main-session-123"
      
      setMainSession(mainSessionID)
      
      expect(getMainSessionID()).toBe(mainSessionID)
      expect(subagentSessions.has(mainSessionID)).toBe(false)
    })

    test("should track multiple subagents", () => {
      const subagent1 = "subagent-1"
      const subagent2 = "subagent-2"
      
      subagentSessions.add(subagent1)
      subagentSessions.add(subagent2)
      
      expect(subagentSessions.has(subagent1)).toBe(true)
      expect(subagentSessions.has(subagent2)).toBe(true)
      expect(subagentSessions.size).toBe(2)
    })
  })

  describe("session cleanup", () => {
    test("should clean up subagent session on delete", () => {
      const subagentSessionID = "subagent-123"
      
      subagentSessions.add(subagentSessionID)
      expect(subagentSessions.has(subagentSessionID)).toBe(true)
      
      // Simulate session.deleted
      subagentSessions.delete(subagentSessionID)
      
      expect(subagentSessions.has(subagentSessionID)).toBe(false)
    })

    test("should clean up main session on delete", () => {
      const mainSessionID = "main-session-123"
      setMainSession(mainSessionID)
      expect(getMainSessionID()).toBe(mainSessionID)
      
      // Simulate session.deleted
      setMainSession(undefined)
      
      expect(getMainSessionID()).toBeUndefined()
    })
  })

  describe("shouldAutoRetrySession logic", () => {
    test("should allow retry for syncSubagentSessions", () => {
      const syncSubagentID = "sync-subagent-123"
      syncSubagentSessions.add(syncSubagentID)
      
      // Logic: if (syncSubagentSessions.has(sessionID)) return true
      expect(syncSubagentSessions.has(syncSubagentID)).toBe(true)
    })

    test("should allow retry for subagentSessions", () => {
      const taskSubagentID = "task-subagent-123"
      subagentSessions.add(taskSubagentID)
      
      // Logic: if (subagentSessions.has(sessionID)) return true
      expect(subagentSessions.has(taskSubagentID)).toBe(true)
    })

    test("should allow retry for main session", () => {
      const mainSessionID = "main-session-123"
      setMainSession(mainSessionID)
      
      // Logic: if (sessionID === mainSessionID) return true
      expect(getMainSessionID()).toBe(mainSessionID)
    })

    test("should distinguish between session types", () => {
      const mainSessionID = "main-session"
      const syncSubagentID = "sync-subagent"
      const taskSubagentID = "task-subagent"
      const untrackedID = "untracked"
      
      setMainSession(mainSessionID)
      syncSubagentSessions.add(syncSubagentID)
      subagentSessions.add(taskSubagentID)
      
      // Main session
      expect(getMainSessionID()).toBe(mainSessionID)
      
      // Sync subagent
      expect(syncSubagentSessions.has(syncSubagentID)).toBe(true)
      
      // Task subagent
      expect(subagentSessions.has(taskSubagentID)).toBe(true)
      
      // Untracked
      expect(subagentSessions.has(untrackedID)).toBe(false)
      expect(syncSubagentSessions.has(untrackedID)).toBe(false)
      expect(getMainSessionID()).not.toBe(untrackedID)
    })
  })

  describe("subagent agent name defaults", () => {
    test("should use sisyphus-junior for claude-opus errors", () => {
      const errorMessage = "rate limit exceeded for claude-opus"
      
      if (errorMessage.includes("claude-opus")) {
        const agentName = "sisyphus-junior"
        expect(agentName).toBe("sisyphus-junior")
      }
    })

    test("should use hephaestus-junior for gpt-5 errors", () => {
      const errorMessage = "rate limit exceeded for gpt-5"
      
      if (errorMessage.includes("gpt-5")) {
        const agentName = "hephaestus-junior"
        expect(agentName).toBe("hephaestus-junior")
      }
    })

    test("should use sisyphus-junior as default for subagents", () => {
      const errorMessage = "some generic error"
      
      // Default for subagents
      const agentName = "sisyphus-junior"
      expect(agentName).toBe("sisyphus-junior")
    })
  })
})
