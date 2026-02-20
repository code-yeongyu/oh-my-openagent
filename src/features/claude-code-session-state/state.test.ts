import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  setSessionAgent,
  getSessionAgent,
  clearSessionAgent,
  updateSessionAgent,
  pinSessionAgent,
  unpinSessionAgent,
  setMainSession,
  getMainSessionID,
  _resetForTesting,
} from "./state"


describe("claude-code-session-state", () => {
  beforeEach(() => {
    // given - clean state before each test
    _resetForTesting()
  })

  afterEach(() => {
    // then - cleanup after each test to prevent pollution
    _resetForTesting()
  })

  describe("setSessionAgent", () => {
    test("should store agent for session", () => {
      // given
      const sessionID = "test-session-1"
      const agent = "Prometheus (Planner)"

      // when
      setSessionAgent(sessionID, agent)

      // then
      expect(getSessionAgent(sessionID)).toBe(agent)
    })

    test("should NOT overwrite existing agent (first-write wins)", () => {
      // given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")

      // when - try to overwrite
      setSessionAgent(sessionID, "sisyphus")

      // then - first agent preserved
      expect(getSessionAgent(sessionID)).toBe("Prometheus (Planner)")
    })

    test("should return undefined for unknown session", () => {
      // given - no session set

      // when / then
      expect(getSessionAgent("unknown-session")).toBeUndefined()
    })
  })

  describe("updateSessionAgent", () => {
    test("should overwrite existing agent", () => {
      // given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")

      // when - force update
      updateSessionAgent(sessionID, "sisyphus")

      // then
      expect(getSessionAgent(sessionID)).toBe("sisyphus")
    })
  })

  describe("clearSessionAgent", () => {
    test("should remove agent from session", () => {
      // given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")
      expect(getSessionAgent(sessionID)).toBe("Prometheus (Planner)")

      // when
      clearSessionAgent(sessionID)

      // then
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("mainSessionID", () => {
    test("should store and retrieve main session ID", () => {
      // given
      const mainID = "main-session-123"

      // when
      setMainSession(mainID)

      // then
      expect(getMainSessionID()).toBe(mainID)
    })

    test("should return undefined when not set", () => {
      // given - explicit reset to ensure clean state (parallel test isolation)
      _resetForTesting()
      // then
      expect(getMainSessionID()).toBeUndefined()
    })
  })

  describe("prometheus-md-only integration scenario", () => {
    test("should correctly identify Prometheus agent for permission checks", () => {
      // given - Prometheus session
      const sessionID = "test-prometheus-session"
      const prometheusAgent = "Prometheus (Planner)"

      // when - agent is set (simulating chat.message hook)
      setSessionAgent(sessionID, prometheusAgent)

      // then - getSessionAgent returns correct agent for prometheus-md-only hook
      const agent = getSessionAgent(sessionID)
      expect(agent).toBe("Prometheus (Planner)")
      expect(["Prometheus (Planner)"].includes(agent!)).toBe(true)
    })

    test("should return undefined when agent not set (bug scenario)", () => {
      // given - session exists but no agent set (the bug)
      const sessionID = "test-prometheus-session"

      // when / then - this is the bug: agent is undefined
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("issue #893: custom agent switch reset", () => {
    test("should preserve custom agent when default agent is sent on subsequent messages", () => {
      // given - user switches to custom agent "MyCustomAgent"
      const sessionID = "test-session-custom"
      const customAgent = "MyCustomAgent"
      const defaultAgent = "sisyphus"

      // User switches to custom agent (via UI)
      setSessionAgent(sessionID, customAgent)
      expect(getSessionAgent(sessionID)).toBe(customAgent)

      // when - first message after switch sends default agent
      // This simulates the bug: input.agent = "Sisyphus" on first message
      // Using setSessionAgent (first-write wins) should preserve custom agent
      setSessionAgent(sessionID, defaultAgent)

      // then - custom agent should be preserved, NOT overwritten
      expect(getSessionAgent(sessionID)).toBe(customAgent)
    })

    test("should allow explicit agent update via updateSessionAgent", () => {
      // given - custom agent is set
      const sessionID = "test-session-explicit"
      const customAgent = "MyCustomAgent"
      const newAgent = "AnotherAgent"

      setSessionAgent(sessionID, customAgent)

      // when - explicit update (user intentionally switches)
      updateSessionAgent(sessionID, newAgent)

      // then - should be updated
      expect(getSessionAgent(sessionID)).toBe(newAgent)
    })
  })

  describe("pinSessionAgent", () => {
    test("should store pinned agent for session", () => {
      // given
      const sessionID = "test-pin-1"

      // when
      pinSessionAgent(sessionID, "atlas")

      // then
      expect(getSessionAgent(sessionID)).toBe("atlas")
    })

    test("should take precedence over updateSessionAgent", () => {
      // given - pin atlas
      const sessionID = "test-pin-priority"
      pinSessionAgent(sessionID, "atlas")

      // when - SDK event tries to overwrite via updateSessionAgent
      updateSessionAgent(sessionID, "prometheus")

      // then - pinned agent still wins
      expect(getSessionAgent(sessionID)).toBe("atlas")
    })

    test("should take precedence over setSessionAgent", () => {
      // given - pin atlas
      const sessionID = "test-pin-over-set"
      pinSessionAgent(sessionID, "atlas")

      // when - setSessionAgent tries to set
      setSessionAgent(sessionID, "prometheus")

      // then - pinned agent still wins
      expect(getSessionAgent(sessionID)).toBe("atlas")
    })

    test("should allow re-pinning to a different agent", () => {
      // given - pin atlas
      const sessionID = "test-repin"
      pinSessionAgent(sessionID, "atlas")

      // when - re-pin to hephaestus
      pinSessionAgent(sessionID, "hephaestus")

      // then
      expect(getSessionAgent(sessionID)).toBe("hephaestus")
    })
  })

  describe("unpinSessionAgent", () => {
    test("should allow updateSessionAgent to take effect after unpin", () => {
      // given - pin atlas, then unpin
      const sessionID = "test-unpin-then-update"
      pinSessionAgent(sessionID, "atlas")
      unpinSessionAgent(sessionID)

      // when - update via SDK event
      updateSessionAgent(sessionID, "prometheus")

      // then - update takes effect since no pin exists
      expect(getSessionAgent(sessionID)).toBe("prometheus")
    })

    test("should be a no-op when no pin exists", () => {
      // given - only regular agent
      const sessionID = "test-unpin-noop"
      setSessionAgent(sessionID, "prometheus")

      // when - unpin (nothing pinned)
      unpinSessionAgent(sessionID)

      // then - regular agent unchanged
      expect(getSessionAgent(sessionID)).toBe("prometheus")
    })
  })

  describe("clearSessionAgent with pinned agents", () => {
    test("should clear both pinned and regular agents", () => {
      // given - pinned agent set
      const sessionID = "test-clear-pinned"
      pinSessionAgent(sessionID, "atlas")

      // when
      clearSessionAgent(sessionID)

      // then - both cleared
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })
})
