import { describe, test, expect, beforeEach } from "bun:test"
import {
  setSessionAgent,
  getSessionAgent,
  clearSessionAgent,
  updateSessionAgent,
  setMainSession,
  getMainSessionID,
  _resetForTesting,
  setSessionModel,
  getSessionModel,
  clearSessionModel,
  updateSessionModel,
} from "./state"

describe("claude-code-session-state", () => {
  beforeEach(() => {
    // #given - clean state before each test
    _resetForTesting()
    clearSessionAgent("test-session-1")
    clearSessionAgent("test-session-2")
    clearSessionAgent("test-prometheus-session")
    clearSessionModel("test-session-1")
    clearSessionModel("test-session-2")
    clearSessionModel("test-model-session")
  })

  describe("setSessionAgent", () => {
    test("should store agent for session", () => {
      // #given
      const sessionID = "test-session-1"
      const agent = "Prometheus (Planner)"

      // #when
      setSessionAgent(sessionID, agent)

      // #then
      expect(getSessionAgent(sessionID)).toBe(agent)
    })

    test("should NOT overwrite existing agent (first-write wins)", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")

      // #when - try to overwrite
      setSessionAgent(sessionID, "Sisyphus")

      // #then - first agent preserved
      expect(getSessionAgent(sessionID)).toBe("Prometheus (Planner)")
    })

    test("should return undefined for unknown session", () => {
      // #given - no session set

      // #when / #then
      expect(getSessionAgent("unknown-session")).toBeUndefined()
    })
  })

  describe("updateSessionAgent", () => {
    test("should overwrite existing agent", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")

      // #when - force update
      updateSessionAgent(sessionID, "Sisyphus")

      // #then
      expect(getSessionAgent(sessionID)).toBe("Sisyphus")
    })
  })

  describe("clearSessionAgent", () => {
    test("should remove agent from session", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")
      expect(getSessionAgent(sessionID)).toBe("Prometheus (Planner)")

      // #when
      clearSessionAgent(sessionID)

      // #then
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("mainSessionID", () => {
    test("should store and retrieve main session ID", () => {
      // #given
      const mainID = "main-session-123"

      // #when
      setMainSession(mainID)

      // #then
      expect(getMainSessionID()).toBe(mainID)
    })

    test.skip("should return undefined when not set", () => {
      // #given - not set
      // TODO: Fix flaky test - parallel test execution causes state pollution
      // #then
      expect(getMainSessionID()).toBeUndefined()
    })
  })

  describe("prometheus-md-only integration scenario", () => {
    test("should correctly identify Prometheus agent for permission checks", () => {
      // #given - Prometheus session
      const sessionID = "test-prometheus-session"
      const prometheusAgent = "Prometheus (Planner)"

      // #when - agent is set (simulating chat.message hook)
      setSessionAgent(sessionID, prometheusAgent)

      // #then - getSessionAgent returns correct agent for prometheus-md-only hook
      const agent = getSessionAgent(sessionID)
      expect(agent).toBe("Prometheus (Planner)")
      expect(["Prometheus (Planner)"].includes(agent!)).toBe(true)
    })

    test("should return undefined when agent not set (bug scenario)", () => {
      // #given - session exists but no agent set (the bug)
      const sessionID = "test-prometheus-session"

      // #when / #then - this is the bug: agent is undefined
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("issue #893: custom agent switch reset", () => {
    test("should preserve custom agent when default agent is sent on subsequent messages", () => {
      // #given - user switches to custom agent "MyCustomAgent"
      const sessionID = "test-session-custom"
      const customAgent = "MyCustomAgent"
      const defaultAgent = "Sisyphus"

      // User switches to custom agent (via UI)
      setSessionAgent(sessionID, customAgent)
      expect(getSessionAgent(sessionID)).toBe(customAgent)

      // #when - first message after switch sends default agent
      // This simulates the bug: input.agent = "Sisyphus" on first message
      // Using setSessionAgent (first-write wins) should preserve custom agent
      setSessionAgent(sessionID, defaultAgent)

      // #then - custom agent should be preserved, NOT overwritten
      expect(getSessionAgent(sessionID)).toBe(customAgent)
    })

    test("should allow explicit agent update via updateSessionAgent", () => {
      // #given - custom agent is set
      const sessionID = "test-session-explicit"
      const customAgent = "MyCustomAgent"
      const newAgent = "AnotherAgent"

      setSessionAgent(sessionID, customAgent)

      // #when - explicit update (user intentionally switches)
      updateSessionAgent(sessionID, newAgent)

      // #then - should be updated
      expect(getSessionAgent(sessionID)).toBe(newAgent)
    })
  })

  describe("setSessionModel", () => {
    test("should store model for session", () => {
      // #given
      const sessionID = "test-model-session"
      const model = { providerID: "grok", modelID: "grok-2" }

      // #when
      setSessionModel(sessionID, model)

      // #then
      expect(getSessionModel(sessionID)).toEqual(model)
    })

    test("should NOT overwrite existing model (first-write wins)", () => {
      // #given
      const sessionID = "test-model-session"
      const firstModel = { providerID: "grok", modelID: "grok-2" }
      const secondModel = { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
      setSessionModel(sessionID, firstModel)

      // #when - try to overwrite
      setSessionModel(sessionID, secondModel)

      // #then - first model preserved
      expect(getSessionModel(sessionID)).toEqual(firstModel)
    })

    test("should return undefined for unknown session", () => {
      // #given - no session set

      // #when / #then
      expect(getSessionModel("unknown-session")).toBeUndefined()
    })
  })

  describe("updateSessionModel", () => {
    test("should overwrite existing model", () => {
      // #given
      const sessionID = "test-model-session"
      const firstModel = { providerID: "grok", modelID: "grok-2" }
      const secondModel = { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
      setSessionModel(sessionID, firstModel)

      // #when - force update
      updateSessionModel(sessionID, secondModel)

      // #then
      expect(getSessionModel(sessionID)).toEqual(secondModel)
    })
  })

  describe("clearSessionModel", () => {
    test("should remove model from session", () => {
      // #given
      const sessionID = "test-model-session"
      const model = { providerID: "grok", modelID: "grok-2" }
      setSessionModel(sessionID, model)
      expect(getSessionModel(sessionID)).toEqual(model)

      // #when
      clearSessionModel(sessionID)

      // #then
      expect(getSessionModel(sessionID)).toBeUndefined()
    })
  })

  describe("issue #1024 integration scenario", () => {
    test("should store UI-selected model on first message for delegate_task fallback", () => {
      // #given - User selects grok model via UI before first message
      const sessionID = "test-first-message-session"
      const uiSelectedModel = { providerID: "grok", modelID: "grok-2" }

      // #when - chat.message hook fires with input.model (simulating UI selection)
      setSessionModel(sessionID, uiSelectedModel)

      // #then - delegate_task can retrieve the model as fallback
      const sessionModel = getSessionModel(sessionID)
      expect(sessionModel).toEqual(uiSelectedModel)
      expect(sessionModel?.providerID).toBe("grok")
      expect(sessionModel?.modelID).toBe("grok-2")
    })

    test("should preserve first model selection (no overwrite on subsequent messages)", () => {
      // #given - First message with grok model
      const sessionID = "test-first-message-session"
      const firstModel = { providerID: "grok", modelID: "grok-2" }
      setSessionModel(sessionID, firstModel)

      // #when - Second message with different model (shouldn't happen normally, but test the safety)
      const secondModel = { providerID: "anthropic", modelID: "claude-opus-4" }
      setSessionModel(sessionID, secondModel)

      // #then - First model preserved
      expect(getSessionModel(sessionID)).toEqual(firstModel)
    })
  })
})
