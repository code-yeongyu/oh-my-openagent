import { describe, expect, test, beforeEach } from "bun:test"
import {
  setSessionAgent,
  getSessionAgent,
  clearSessionAgent,
  setMainSession,
  getMainSessionID,
} from "./state"

describe("session agent tracking", () => {
  beforeEach(() => {
    // #given - clean state before each test
    clearSessionAgent("test-session-1")
    clearSessionAgent("test-session-2")
  })

  test("should set and get session agent", () => {
    // #given - a session ID and agent name
    const sessionID = "test-session-1"
    const agentName = "Prometheus (Planner)"

    // #when - setSessionAgent is called
    setSessionAgent(sessionID, agentName)

    // #then - getSessionAgent should return the agent name
    expect(getSessionAgent(sessionID)).toBe(agentName)
  })

  test("should return undefined for unknown session", () => {
    // #given - no agent has been set for this session
    const sessionID = "unknown-session"

    // #when - getSessionAgent is called
    const result = getSessionAgent(sessionID)

    // #then - it should return undefined
    expect(result).toBeUndefined()
  })

  test("should clear session agent", () => {
    // #given - a session with an agent set
    const sessionID = "test-session-1"
    setSessionAgent(sessionID, "Prometheus (Planner)")

    // #when - clearSessionAgent is called
    clearSessionAgent(sessionID)

    // #then - getSessionAgent should return undefined
    expect(getSessionAgent(sessionID)).toBeUndefined()
  })

  test("should track multiple sessions independently", () => {
    // #given - two different sessions
    const session1 = "test-session-1"
    const session2 = "test-session-2"
    const agent1 = "Prometheus (Planner)"
    const agent2 = "Sisyphus"

    // #when - different agents are set for each session
    setSessionAgent(session1, agent1)
    setSessionAgent(session2, agent2)

    // #then - each session should return its own agent
    expect(getSessionAgent(session1)).toBe(agent1)
    expect(getSessionAgent(session2)).toBe(agent2)
  })

  test("should overwrite agent when set again", () => {
    // #given - a session with an agent already set
    const sessionID = "test-session-1"
    setSessionAgent(sessionID, "Prometheus (Planner)")

    // #when - a different agent is set for the same session
    setSessionAgent(sessionID, "Sisyphus")

    // #then - the new agent should be returned
    expect(getSessionAgent(sessionID)).toBe("Sisyphus")
  })
})

describe("main session tracking", () => {
  beforeEach(() => {
    // #given - clean state
    setMainSession(undefined)
  })

  test("should set and get main session ID", () => {
    // #given - a session ID
    const sessionID = "main-test-session"

    // #when - setMainSession is called
    setMainSession(sessionID)

    // #then - getMainSessionID should return the session ID
    expect(getMainSessionID()).toBe(sessionID)
  })

  test("should return undefined when no main session is set", () => {
    // #given - no main session has been set
    setMainSession(undefined)

    // #when - getMainSessionID is called
    const result = getMainSessionID()

    // #then - it should return undefined
    expect(result).toBeUndefined()
  })
})
