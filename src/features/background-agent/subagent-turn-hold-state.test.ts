/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import {
  clearAllTurnHoldStateForTesting,
  clearTurnState,
  hasPlanInCurrentTurn,
  markSubagentTypeInTurn,
} from "./subagent-turn-hold-state"

describe("subagent-turn-hold-state", () => {
  afterEach(() => {
    clearAllTurnHoldStateForTesting()
  })

  it("should record subagent types in lowercase", () => {
    const sessionID = "session-1"
    markSubagentTypeInTurn(sessionID, "PLAN")
    markSubagentTypeInTurn(sessionID, "Explore")

    expect(hasPlanInCurrentTurn(sessionID)).toBe(true)
  })

  it("should return true for hasPlanInCurrentTurn when plan is recorded", () => {
    const sessionID = "session-1"
    markSubagentTypeInTurn(sessionID, "plan")

    expect(hasPlanInCurrentTurn(sessionID)).toBe(true)
  })

  it("should return false for hasPlanInCurrentTurn when plan is not recorded", () => {
    const sessionID = "session-1"
    markSubagentTypeInTurn(sessionID, "explore")

    expect(hasPlanInCurrentTurn(sessionID)).toBe(false)
  })

  it("should return false for hasPlanInCurrentTurn for non-existent session", () => {
    expect(hasPlanInCurrentTurn("non-existent-session")).toBe(false)
  })


  it("should clear turn state completely", () => {
    const sessionID = "session-1"
    markSubagentTypeInTurn(sessionID, "plan")

    clearTurnState(sessionID)

    expect(hasPlanInCurrentTurn(sessionID)).toBe(false)
  })

  it("should maintain independent state for multiple sessions", () => {
    const sessionID1 = "session-1"
    const sessionID2 = "session-2"

    markSubagentTypeInTurn(sessionID1, "plan")
    markSubagentTypeInTurn(sessionID2, "explore")

    expect(hasPlanInCurrentTurn(sessionID1)).toBe(true)
    expect(hasPlanInCurrentTurn(sessionID2)).toBe(false)
  })

  it("should not affect other sessions when clearing a session", () => {
    const sessionID1 = "session-1"
    const sessionID2 = "session-2"

    markSubagentTypeInTurn(sessionID1, "plan")
    markSubagentTypeInTurn(sessionID2, "plan")

    clearTurnState(sessionID1)

    expect(hasPlanInCurrentTurn(sessionID1)).toBe(false)
    expect(hasPlanInCurrentTurn(sessionID2)).toBe(true)
  })

  it("should clear all turn hold state for testing", () => {
    const sessionID1 = "session-1"
    const sessionID2 = "session-2"

    markSubagentTypeInTurn(sessionID1, "plan")
    markSubagentTypeInTurn(sessionID2, "explore")

    clearAllTurnHoldStateForTesting()

    expect(hasPlanInCurrentTurn(sessionID1)).toBe(false)
    expect(hasPlanInCurrentTurn(sessionID2)).toBe(false)
  })
})
