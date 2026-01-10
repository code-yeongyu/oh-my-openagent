import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { mkdirSync, rmdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { StateManager } from "./state-manager"
import type { BoulderState } from "../features/boulder-state/types"
import type { RalphLoopState } from "../hooks/ralph-loop/types"
import { BOULDER_DIR, BOULDER_FILE } from "../features/boulder-state/constants"
import { DEFAULT_STATE_FILE } from "../hooks/ralph-loop/constants"

const TEST_DIR = join(process.cwd(), "test-state-manager-tmp")

describe("StateManager", () => {
  let stateManager: StateManager

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmdirSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    stateManager = new StateManager(TEST_DIR)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmdirSync(TEST_DIR, { recursive: true })
    }
  })

  it("should read and write boulder state", () => {
    const boulderState: BoulderState = {
      active_plan: "/path/to/plan.md",
      started_at: new Date().toISOString(),
      session_ids: ["session-1"],
      plan_name: "test-plan"
    }

    stateManager.setBoulderState(boulderState)
    
    const boulderPath = join(TEST_DIR, BOULDER_DIR, BOULDER_FILE)
    expect(existsSync(boulderPath)).toBe(true)
    
    const readState = stateManager.getBoulderState()
    expect(readState).toEqual(boulderState)
  })

  it("should read and write ralph loop state", () => {
    const ralphState: RalphLoopState = {
      active: true,
      iteration: 1,
      max_iterations: 10,
      completion_promise: "promise",
      started_at: new Date().toISOString(),
      prompt: "do something"
    }

    stateManager.setRalphState(ralphState)

    const ralphPath = join(TEST_DIR, DEFAULT_STATE_FILE)
    expect(existsSync(ralphPath)).toBe(true)

    const readState = stateManager.getRalphState()
    expect(readState).toEqual(ralphState)
  })

  it("should create and restore snapshots", () => {
    const boulderState: BoulderState = {
      active_plan: "/path/to/plan.md",
      started_at: "2024-01-01T00:00:00.000Z",
      session_ids: ["session-1"],
      plan_name: "test-plan"
    }
    stateManager.setBoulderState(boulderState)

    const snapshotId = stateManager.createSnapshot()
    expect(snapshotId).toBeDefined()

    const newState: BoulderState = { ...boulderState, session_ids: ["session-1", "session-2"] }
    stateManager.setBoulderState(newState)
    expect(stateManager.getBoulderState()).toEqual(newState)

    const success = stateManager.restoreSnapshot(snapshotId)
    expect(success).toBe(true)
    expect(stateManager.getBoulderState()).toEqual(boulderState)
  })

  it("should provide state diffs", () => {
    const initialState: BoulderState = {
        active_plan: "/path/to/plan.md",
        started_at: "2024-01-01T00:00:00.000Z",
        session_ids: ["session-1"],
        plan_name: "test-plan"
      }
      stateManager.setBoulderState(initialState)
  
      const snapshotId = stateManager.createSnapshot()
  
      const newState: BoulderState = { ...initialState, session_ids: ["session-1", "session-2"] }
      stateManager.setBoulderState(newState)
  
      const diff = stateManager.getDiff(snapshotId)
      expect(diff.boulder).toBeDefined()
      expect(JSON.stringify(diff)).toContain("session-2")
  })
  
  it("should handle mixed state snapshots (both boulder and ralph)", () => {
      const boulderState: BoulderState = {
          active_plan: "/path/to/plan.md",
          started_at: "2024-01-01T00:00:00.000Z",
          session_ids: ["session-1"],
          plan_name: "test-plan"
      }
      const ralphState: RalphLoopState = {
          active: true,
          iteration: 1,
          max_iterations: 10,
          completion_promise: "promise",
          started_at: "2024-01-01T00:00:00.000Z",
          prompt: "do something"
      }

      stateManager.setBoulderState(boulderState)
      stateManager.setRalphState(ralphState)

      const snapshotId = stateManager.createSnapshot()

      stateManager.setBoulderState({ ...boulderState, plan_name: "changed" })
      stateManager.setRalphState({ ...ralphState, iteration: 2 })

      stateManager.restoreSnapshot(snapshotId)

      expect(stateManager.getBoulderState()).toEqual(boulderState)
      expect(stateManager.getRalphState()).toEqual(ralphState)
  })
})
