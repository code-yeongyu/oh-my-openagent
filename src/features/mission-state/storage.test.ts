import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendSessionId,
  clearMissionState,
  createMissionState,
  getPlanName,
  getPlanProgress,
  readMissionState,
  writeMissionState,
} from "./storage"
import type { MissionState } from "./types"

describe("mission-state", () => {
  const TEST_DIR = join(tmpdir(), `mission-state-test-${Date.now()}`)
  const MATRIX_DIR = join(TEST_DIR, ".matrixx")

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(MATRIX_DIR)) {
      mkdirSync(MATRIX_DIR, { recursive: true })
    }
    clearMissionState(TEST_DIR)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("readMissionState", () => {
    test("should return null when no mission.json exists", () => {
      // given - no mission.json file
      // when
      const result = readMissionState(TEST_DIR)
      // then
      expect(result).toBeNull()
    })

    test("should return null for JSON null value", () => {
      //#given - mission.json containing null
      const missionFile = join(MATRIX_DIR, "mission.json")
      writeFileSync(missionFile, "null")

      //#when
      const result = readMissionState(TEST_DIR)

      //#then
      expect(result).toBeNull()
    })

    test("should return null for JSON primitive value", () => {
      //#given - mission.json containing a string
      const missionFile = join(MATRIX_DIR, "mission.json")
      writeFileSync(missionFile, '"just a string"')

      //#when
      const result = readMissionState(TEST_DIR)

      //#then
      expect(result).toBeNull()
    })

    test("should default session_ids to [] when missing from JSON", () => {
      //#given - mission.json without session_ids field
      const missionFile = join(MATRIX_DIR, "mission.json")
      writeFileSync(missionFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        plan_name: "plan",
      }))

      //#when
      const result = readMissionState(TEST_DIR)

      //#then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual([])
    })

    test("should default session_ids to [] when not an array", () => {
      //#given - mission.json with session_ids as a string
      const missionFile = join(MATRIX_DIR, "mission.json")
      writeFileSync(missionFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: "not-an-array",
        plan_name: "plan",
      }))

      //#when
      const result = readMissionState(TEST_DIR)

      //#then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual([])
    })

    test("should default session_ids to [] for empty object", () => {
      //#given - mission.json with empty object
      const missionFile = join(MATRIX_DIR, "mission.json")
      writeFileSync(missionFile, JSON.stringify({}))

      //#when
      const result = readMissionState(TEST_DIR)

      //#then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual([])
    })

    test("should read valid mission state", () => {
      // given - valid mission.json
      const state: MissionState = {
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1", "session-2"],
        plan_name: "my-plan",
      }
      writeMissionState(TEST_DIR, state)

      // when
      const result = readMissionState(TEST_DIR)

      // then
      expect(result).not.toBeNull()
      expect(result?.active_plan).toBe("/path/to/plan.md")
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
      expect(result?.plan_name).toBe("my-plan")
    })
  })

  describe("writeMissionState", () => {
    test("should write state and create .matrixx directory if needed", () => {
      // given - state to write
      const state: MissionState = {
        active_plan: "/test/plan.md",
        started_at: "2026-01-02T12:00:00Z",
        session_ids: ["ses-123"],
        plan_name: "test-plan",
      }

      // when
      const success = writeMissionState(TEST_DIR, state)
      const readBack = readMissionState(TEST_DIR)

      // then
      expect(success).toBe(true)
      expect(readBack).not.toBeNull()
      expect(readBack?.active_plan).toBe("/test/plan.md")
    })
  })

  describe("appendSessionId", () => {
    test("should append new session id to existing state", () => {
      // given - existing state with one session
      const state: MissionState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeMissionState(TEST_DIR, state)

      // when
      const result = appendSessionId(TEST_DIR, "session-2")

      // then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
    })

    test("should not duplicate existing session id", () => {
      // given - state with session-1 already
      const state: MissionState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeMissionState(TEST_DIR, state)

      // when
      appendSessionId(TEST_DIR, "session-1")
      const result = readMissionState(TEST_DIR)

      // then
      expect(result?.session_ids).toEqual(["session-1"])
    })

    test("should return null when no state exists", () => {
      // given - no mission.json
      // when
      const result = appendSessionId(TEST_DIR, "new-session")
      // then
      expect(result).toBeNull()
    })

    test("should not crash when mission.json has no session_ids field", () => {
      //#given - mission.json without session_ids
      const missionFile = join(MATRIX_DIR, "mission.json")
      writeFileSync(missionFile, JSON.stringify({
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        plan_name: "plan",
      }))

      //#when
      const result = appendSessionId(TEST_DIR, "ses-new")

      //#then - should not crash and should contain the new session
      expect(result).not.toBeNull()
      expect(result?.session_ids).toContain("ses-new")
    })
  })

  describe("clearMissionState", () => {
    test("should remove mission.json", () => {
      // given - existing state
      const state: MissionState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeMissionState(TEST_DIR, state)

      // when
      const success = clearMissionState(TEST_DIR)
      const result = readMissionState(TEST_DIR)

      // then
      expect(success).toBe(true)
      expect(result).toBeNull()
    })

    test("should succeed even when no file exists", () => {
      // given - no mission.json
      // when
      const success = clearMissionState(TEST_DIR)
      // then
      expect(success).toBe(true)
    })
  })

  describe("getPlanProgress", () => {
    test("should count completed and uncompleted checkboxes", () => {
      // given - plan file with checkboxes
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, `# Plan
- [ ] Task 1
- [x] Task 2  
- [ ] Task 3
- [X] Task 4
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(4)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(false)
    })

    test("should return isComplete true when all checked", () => {
      // given - all tasks completed
      const planPath = join(TEST_DIR, "complete-plan.md")
      writeFileSync(planPath, `# Plan
- [x] Task 1
- [X] Task 2
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(true)
    })

    test("should return isComplete true for empty plan", () => {
      // given - plan with no checkboxes
      const planPath = join(TEST_DIR, "empty-plan.md")
      writeFileSync(planPath, "# Plan\nNo tasks here")

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(0)
      expect(progress.isComplete).toBe(true)
    })

    test("should handle non-existent file", () => {
      // given - non-existent file
      // when
      const progress = getPlanProgress("/non/existent/file.md")
      // then
      expect(progress.total).toBe(0)
      expect(progress.isComplete).toBe(true)
    })
  })

  describe("getPlanName", () => {
    test("should extract plan name from path", () => {
      // given
      const path = "/home/user/.matrixx/plans/project/my-feature.md"
      // when
      const name = getPlanName(path)
      // then
      expect(name).toBe("my-feature")
    })
  })

  describe("createMissionState", () => {
    test("should create state with correct fields", () => {
      // given
      const planPath = "/path/to/auth-refactor.md"
      const sessionId = "ses-abc123"

      // when
      const state = createMissionState(planPath, sessionId)

      // then
      expect(state.active_plan).toBe(planPath)
      expect(state.session_ids).toEqual([sessionId])
      expect(state.plan_name).toBe("auth-refactor")
      expect(state.started_at).toBeDefined()
    })

    test("should include agent field when provided", () => {
      //#given - plan path, session id, and agent type
      const planPath = "/path/to/feature.md"
      const sessionId = "ses-xyz789"
      const agent = "architect"

      //#when - createMissionState is called with agent
      const state = createMissionState(planPath, sessionId, agent)

      //#then - state should include the agent field
      expect(state.agent).toBe("architect")
      expect(state.active_plan).toBe(planPath)
      expect(state.session_ids).toEqual([sessionId])
      expect(state.plan_name).toBe("feature")
    })

    test("should allow agent to be undefined", () => {
      //#given - plan path and session id without agent
      const planPath = "/path/to/legacy.md"
      const sessionId = "ses-legacy"

      //#when - createMissionState is called without agent
      const state = createMissionState(planPath, sessionId)

      //#then - state should not have agent field (backward compatible)
      expect(state.agent).toBeUndefined()
    })
  })
})
