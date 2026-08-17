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

  it("records subagent types case-insensitively", () => {
    markSubagentTypeInTurn("session-1", "PLAN")
    markSubagentTypeInTurn("session-1", "Explore")

    expect(hasPlanInCurrentTurn("session-1")).toBe(true)
  })

  it("returns false when plan was not recorded", () => {
    markSubagentTypeInTurn("session-1", "explore")

    expect(hasPlanInCurrentTurn("session-1")).toBe(false)
  })

  it("clears one session without affecting another", () => {
    markSubagentTypeInTurn("session-1", "plan")
    markSubagentTypeInTurn("session-2", "plan")

    clearTurnState("session-1")

    expect(hasPlanInCurrentTurn("session-1")).toBe(false)
    expect(hasPlanInCurrentTurn("session-2")).toBe(true)
  })

  it("returns false for an unknown session", () => {
    expect(hasPlanInCurrentTurn("unknown")).toBe(false)
  })
})
