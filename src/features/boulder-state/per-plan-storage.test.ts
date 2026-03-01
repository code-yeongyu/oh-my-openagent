import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  findBoulderStateBySession,
  listActiveBoulderStates,
  clearBoulderStateForPlan,
  appendSessionIdForPlan,
  writeBoulderStateForPlan,
} from "./per-plan-storage"
import type { BoulderState } from "./types"

describe("per-plan-storage", () => {
  const TEST_DIR = join(tmpdir(), "per-plan-storage-test-" + Date.now())

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("findBoulderStateBySession", () => {
    test("should return null when no plans exist", () => {
      // given - no plans directory
      // when
      const result = findBoulderStateBySession(TEST_DIR, "session-1")
      // then
      expect(result).toBeNull()
    })

    test("should find state when session is in one of multiple plan files", () => {
      // given - multiple plan files with different sessions
      const state1: BoulderState = {
        active_plan: "/plan1.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1", "session-2"],
        plan_name: "plan1",
      }
      const state2: BoulderState = {
        active_plan: "/plan2.md",
        started_at: "2026-01-02T00:00:00Z",
        session_ids: ["session-3"],
        plan_name: "plan2",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan1", state1)
      writeBoulderStateForPlan(TEST_DIR, "plan2", state2)

      // when
      const result = findBoulderStateBySession(TEST_DIR, "session-2")

      // then
      expect(result).not.toBeNull()
      expect(result?.plan_name).toBe("plan1")
      expect(result?.session_ids).toContain("session-2")
    })

    test("should return null when session is not in any plan", () => {
      // given - plans exist but don't contain the session
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan", state)

      // when
      const result = findBoulderStateBySession(TEST_DIR, "session-999")

      // then
      expect(result).toBeNull()
    })
  })

  describe("listActiveBoulderStates", () => {
    test("should return empty array when no plans dir exists", () => {
      // given - no plans directory
      // when
      const result = listActiveBoulderStates(TEST_DIR)
      // then
      expect(result).toEqual([])
    })

    test("should return all plan states when multiple plan files exist", () => {
      // given - multiple plan files
      const state1: BoulderState = {
        active_plan: "/plan1.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan1",
      }
      const state2: BoulderState = {
        active_plan: "/plan2.md",
        started_at: "2026-01-02T00:00:00Z",
        session_ids: ["session-2"],
        plan_name: "plan2",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan1", state1)
      writeBoulderStateForPlan(TEST_DIR, "plan2", state2)

      // when
      const result = listActiveBoulderStates(TEST_DIR)

      // then
      expect(result).toHaveLength(2)
      expect(result.map((s) => s.plan_name)).toContain("plan1")
      expect(result.map((s) => s.plan_name)).toContain("plan2")
    })

    test("should ignore non-JSON files in the plans directory", () => {
      // given - plans dir with JSON and non-JSON files
      const plansDir = join(TEST_DIR, ".sisyphus", "boulder")
      mkdirSync(plansDir, { recursive: true })
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan", state)

      // when
      const result = listActiveBoulderStates(TEST_DIR)

      // then
      expect(result).toHaveLength(1)
      expect(result[0]?.plan_name).toBe("plan")
    })
  })

  describe("clearBoulderStateForPlan", () => {
    test("should remove the plan file", () => {
      // given - existing plan state
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan", state)

      // when
      const success = clearBoulderStateForPlan(TEST_DIR, "plan")
      const result = listActiveBoulderStates(TEST_DIR)

      // then
      expect(success).toBe(true)
      expect(result).toHaveLength(0)
    })

    test("should return true even when file doesn't exist", () => {
      // given - no plan file
      // when
      const success = clearBoulderStateForPlan(TEST_DIR, "nonexistent")
      // then
      expect(success).toBe(true)
    })

    test("should leave other plan files untouched", () => {
      // given - multiple plan files
      const state1: BoulderState = {
        active_plan: "/plan1.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan1",
      }
      const state2: BoulderState = {
        active_plan: "/plan2.md",
        started_at: "2026-01-02T00:00:00Z",
        session_ids: ["session-2"],
        plan_name: "plan2",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan1", state1)
      writeBoulderStateForPlan(TEST_DIR, "plan2", state2)

      // when
      clearBoulderStateForPlan(TEST_DIR, "plan1")
      const result = listActiveBoulderStates(TEST_DIR)

      // then
      expect(result).toHaveLength(1)
      expect(result[0]?.plan_name).toBe("plan2")
    })
  })

  describe("appendSessionIdForPlan", () => {
    test("should append new session ID to existing plan state", () => {
      // given - existing plan with one session
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan", state)

      // when
      const result = appendSessionIdForPlan(TEST_DIR, "plan", "session-2")

      // then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
    })

    test("should not duplicate existing session ID", () => {
      // given - plan with session-1
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan", state)

      // when
      const result = appendSessionIdForPlan(TEST_DIR, "plan", "session-1")

      // then
      expect(result?.session_ids).toEqual(["session-1"])
    })

    test("should return null when plan doesn't exist", () => {
      // given - no plan file
      // when
      const result = appendSessionIdForPlan(TEST_DIR, "nonexistent", "session-1")
      // then
      expect(result).toBeNull()
    })

    test("should initialize session_ids array if missing", () => {
      // given - plan state without session_ids field
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: [],
        plan_name: "plan",
      }
      writeBoulderStateForPlan(TEST_DIR, "plan", state)

      // when
      const result = appendSessionIdForPlan(TEST_DIR, "plan", "session-new")

      // then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toContain("session-new")
    })
  })
})
