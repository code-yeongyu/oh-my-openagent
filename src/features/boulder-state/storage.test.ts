import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  addBoulderWork,
  appendSessionIdForWork,
  completeBoulder,
  endTaskTimer,
  getActiveWorks,
  getBoulderWorks,
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  clearBoulderState,
  getWorkById,
  getWorkByPlanName,
  getWorkForSession,
  getWorkResumeOptions,
  getPlanProgress,
  getPlanName,
  createBoulderState,
  findPrometheusPlans,
  getTaskSessionState,
  resolveBoulderPlanPath,
  resolveBoulderPlanPathForWork,
  selectActiveWork,
  startTaskTimer,
  upsertTaskSessionState,
  upsertTaskSessionStateForWork,
} from "./storage"
import type { BoulderState } from "./types"
import { readCurrentTopLevelTask } from "./top-level-task"

describe("boulder-state", () => {
  const TEST_DIR = join(tmpdir(), "boulder-state-test-" + Date.now())
  const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(SISYPHUS_DIR)) {
      mkdirSync(SISYPHUS_DIR, { recursive: true })
    }
    clearBoulderState(TEST_DIR)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("readBoulderState", () => {
    test("should preserve legacy boulder.json fields during round-trip", () => {
      // given
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      const legacyRawState = {
        active_plan: "/path/to/legacy-plan.md",
        started_at: "2026-01-01T00:00:00.000Z",
        session_ids: ["legacy-session"],
        plan_name: "legacy-plan",
      }
      writeFileSync(boulderFile, JSON.stringify(legacyRawState, null, 2), "utf-8")

      // when
      const state = readBoulderState(TEST_DIR)
      expect(state).not.toBeNull()
      const writeSucceeded = writeBoulderState(TEST_DIR, state!)
      const roundTripState = readBoulderState(TEST_DIR)

      // then
      expect(writeSucceeded).toBe(true)
      expect(roundTripState?.active_plan).toBe(legacyRawState.active_plan)
      expect(roundTripState?.started_at).toBe(legacyRawState.started_at)
      expect(roundTripState?.session_ids).toEqual(legacyRawState.session_ids)
      expect(roundTripState?.plan_name).toBe(legacyRawState.plan_name)
    })

    test("should return null when no boulder.json exists", () => {
      // given - no boulder.json file
      // when
      const result = readBoulderState(TEST_DIR)
      // then
      expect(result).toBeNull()
    })

    test("should return null for JSON null value", () => {
      //#given - boulder.json containing null
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, "null")

      //#when
      const result = readBoulderState(TEST_DIR)

      //#then
      expect(result).toBeNull()
    })

    test("should return null for JSON primitive value", () => {
      //#given - boulder.json containing a string
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, '"just a string"')

      //#when
      const result = readBoulderState(TEST_DIR)

      //#then
      expect(result).toBeNull()
    })

    test("should default session_ids to [] when missing from JSON", () => {
      //#given - boulder.json without session_ids field
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        plan_name: "plan",
      }))

      //#when
      const result = readBoulderState(TEST_DIR)

      //#then
      expect(result).not.toBeNull()
      expect(result!.session_ids).toEqual([])
    })

    test("should default session_ids to [] when not an array", () => {
      //#given - boulder.json with session_ids as a string
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: "not-an-array",
        plan_name: "plan",
      }))

      //#when
      const result = readBoulderState(TEST_DIR)

      //#then
      expect(result).not.toBeNull()
      expect(result!.session_ids).toEqual([])
    })

    test("should default session_ids to [] for empty object", () => {
      //#given - boulder.json with empty object
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({}))

      //#when
      const result = readBoulderState(TEST_DIR)

      //#then
      expect(result).not.toBeNull()
      expect(result!.session_ids).toEqual([])
    })

    test("should backfill missing origin as direct only for a single tracked session", () => {
      // given
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }))

      // when
      const result = readBoulderState(TEST_DIR)

      // then
      expect(result?.session_origins).toEqual({ "session-1": "direct" })
    })

    test("should keep missing origins empty when multiple sessions are tracked", () => {
      // given
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1", "session-2"],
        plan_name: "plan",
      }))

      // when
      const result = readBoulderState(TEST_DIR)

      // then
      expect(result?.session_origins).toEqual({})
    })
    test("should read valid boulder state", () => {
      // given - valid boulder.json
      const state: BoulderState = {
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1", "session-2"],
        plan_name: "my-plan",
      }
      writeBoulderState(TEST_DIR, state)

      // when
      const result = readBoulderState(TEST_DIR)

      // then
      expect(result).not.toBeNull()
      expect(result?.active_plan).toBe("/path/to/plan.md")
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
      expect(result?.plan_name).toBe("my-plan")
    })

    test("should default task_sessions to empty object when missing from JSON", () => {
      // given - boulder.json without task_sessions field
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }))

      // when
      const result = readBoulderState(TEST_DIR)

      // then
      expect(result).not.toBeNull()
      expect(result!.task_sessions).toEqual({})
    })
  })

  describe("writeBoulderState", () => {
    test("should write state and create .sisyphus directory if needed", () => {
      // given - state to write
      const state: BoulderState = {
        active_plan: "/test/plan.md",
        started_at: "2026-01-02T12:00:00Z",
        session_ids: ["ses-123"],
        plan_name: "test-plan",
      }

      // when
      const success = writeBoulderState(TEST_DIR, state)
      const readBack = readBoulderState(TEST_DIR)

      // then
      expect(success).toBe(true)
      expect(readBack).not.toBeNull()
      expect(readBack?.active_plan).toBe("/test/plan.md")
    })
  })

  describe("appendSessionId", () => {
    test("should append new session id to existing state", () => {
      // given - existing state with one session
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // when
      const result = appendSessionId(TEST_DIR, "session-2")

      // then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
    })

    test("should not duplicate existing session id", () => {
      // given - state with session-1 already
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // when
      appendSessionId(TEST_DIR, "session-1")
      const result = readBoulderState(TEST_DIR)

      // then
      expect(result?.session_ids).toEqual(["session-1"])
    })

    test("should return null when no state exists", () => {
      // given - no boulder.json
      // when
      const result = appendSessionId(TEST_DIR, "new-session")
      // then
      expect(result).toBeNull()
    })

    test("should not crash when boulder.json has no session_ids field", () => {
      //#given - boulder.json without session_ids
      const boulderFile = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderFile, JSON.stringify({
        active_plan: "/plan.md",
        started_at: "2026-01-01T00:00:00Z",
        plan_name: "plan",
      }))

      //#when
      const result = appendSessionId(TEST_DIR, "ses-new")

      //#then - should not crash and should contain the new session
      expect(result).not.toBeNull()
      expect(result!.session_ids).toContain("ses-new")
    })

    test("should persist appended session origin when provided", () => {
      // given
      writeBoulderState(TEST_DIR, {
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        session_origins: { "session-1": "direct" },
        plan_name: "plan",
      })

      // when
      const result = appendSessionId(TEST_DIR, "session-2", "appended")

      // then
      expect(result?.session_origins).toEqual({
        "session-1": "direct",
        "session-2": "appended",
      })
    })
  })

  describe("clearBoulderState", () => {
    test("should remove boulder.json", () => {
      // given - existing state
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // when
      const success = clearBoulderState(TEST_DIR)
      const result = readBoulderState(TEST_DIR)

      // then
      expect(success).toBe(true)
      expect(result).toBeNull()
    })

    test("should succeed even when no file exists", () => {
      // given - no boulder.json
      // when
      const success = clearBoulderState(TEST_DIR)
      // then
      expect(success).toBe(true)
    })
  })

  describe("task session state", () => {
    test("should persist and read preferred session for a top-level plan task", () => {
      // given - existing boulder state
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // when
      upsertTaskSessionState(TEST_DIR, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "Implement auth flow",
        sessionId: "ses_task_123",
        agent: "sisyphus-junior",
        category: "deep",
      })
      const result = getTaskSessionState(TEST_DIR, "todo:1")

      // then
      expect(result).not.toBeNull()
      expect(result?.session_id).toBe("ses_task_123")
      expect(result?.task_title).toBe("Implement auth flow")
      expect(result?.agent).toBe("sisyphus-junior")
      expect(result?.category).toBe("deep")
    })

    test("should overwrite preferred session for the same top-level plan task", () => {
      // given - existing boulder state with prior preferred session
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
        task_sessions: {
          "todo:1": {
            task_key: "todo:1",
            task_label: "1",
            task_title: "Implement auth flow",
            session_id: "ses_old",
            updated_at: "2026-01-02T10:00:00Z",
          },
        },
      }
      writeBoulderState(TEST_DIR, state)

      // when
      upsertTaskSessionState(TEST_DIR, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "Implement auth flow",
        sessionId: "ses_new",
      })
      const result = getTaskSessionState(TEST_DIR, "todo:1")

      // then
      expect(result?.session_id).toBe("ses_new")
    })
  })

  describe("multi-work helpers", () => {
    test("should add second work and keep both active works", () => {
      // given
      const firstState = createBoulderState(
        join(TEST_DIR, ".sisyphus/plans/plan-a.md"),
        "session-a",
        "atlas",
        "/worktree-a",
      )
      writeBoulderState(TEST_DIR, firstState)
      const firstWorkId = firstState.active_work_id

      // when
      const updatedState = addBoulderWork(TEST_DIR, {
        planPath: join(TEST_DIR, ".sisyphus/plans/plan-b.md"),
        sessionId: "session-b",
        agent: "atlas",
        worktreePath: "/worktree-b",
      })

      // then
      expect(updatedState).not.toBeNull()
      const works = updatedState?.works ?? {}
      expect(Object.keys(works).length).toBe(2)
      expect(firstWorkId).toBeDefined()
      expect(works[firstWorkId!]).toBeDefined()
      expect(updatedState?.active_plan).toContain("plan-b.md")
      expect(getActiveWorks(TEST_DIR).length).toBe(2)
    })

    test("should resolve work for session using updated_at tie-break", () => {
      // given
      const baseState = createBoulderState(
        join(TEST_DIR, ".sisyphus/plans/plan-a.md"),
        "session-a",
      )
      writeBoulderState(TEST_DIR, baseState)
      const stateWithSecond = addBoulderWork(TEST_DIR, {
        planPath: join(TEST_DIR, ".sisyphus/plans/plan-b.md"),
        sessionId: "session-b",
      })
      expect(stateWithSecond).not.toBeNull()

      const workIds = Object.keys(stateWithSecond!.works ?? {})
      expect(workIds.length).toBe(2)
      const firstWorkId = workIds.find((workId) => (stateWithSecond!.works?.[workId]?.plan_name ?? "") === "plan-a")!
      const secondWorkId = workIds.find((workId) => (stateWithSecond!.works?.[workId]?.plan_name ?? "") === "plan-b")!

      appendSessionIdForWork(TEST_DIR, secondWorkId, "session-a", "appended")
      appendSessionIdForWork(TEST_DIR, firstWorkId, "session-a", "appended")

      // when
      const resolvedWork = getWorkForSession(TEST_DIR, "session-a")

      // then
      expect(resolvedWork?.work_id).toBe(firstWorkId)
    })

    test("should support selecting active work and read helpers", () => {
      // given
      const initialState = createBoulderState(join(TEST_DIR, ".sisyphus/plans/plan-a.md"), "session-a")
      writeBoulderState(TEST_DIR, initialState)
      const added = addBoulderWork(TEST_DIR, {
        planPath: join(TEST_DIR, ".sisyphus/plans/plan-b.md"),
        sessionId: "session-b",
        worktreePath: "/tmp/worktree-b",
      })
      expect(added).not.toBeNull()
      const firstWork = getWorkByPlanName(TEST_DIR, "plan-a")
      expect(firstWork).not.toBeNull()

      // when
      const selected = selectActiveWork(TEST_DIR, firstWork!.work_id)
      const selectedById = getWorkById(TEST_DIR, firstWork!.work_id)
      const byPlanNameWithWorktree = getWorkByPlanName(TEST_DIR, "plan-b", { worktreePath: "/tmp/worktree-b" })
      const byPlanPath = resolveBoulderPlanPathForWork(TEST_DIR, firstWork!)
      const resumeOptions = getWorkResumeOptions(TEST_DIR)
      const worksFromState = getBoulderWorks(selected!)

      // then
      expect(selected?.active_work_id).toBe(firstWork!.work_id)
      expect(selectedById?.work_id).toBe(firstWork!.work_id)
      expect(byPlanNameWithWorktree?.plan_name).toBe("plan-b")
      expect(byPlanPath.endsWith("plan-a.md")).toBe(true)
      expect(resumeOptions.length).toBe(2)
      expect(worksFromState.length).toBe(2)
    })

    test("should upsert task session for specific work and keep first started_at", () => {
      // given
      const initialState = createBoulderState(join(TEST_DIR, ".sisyphus/plans/plan-a.md"), "session-a")
      writeBoulderState(TEST_DIR, initialState)
      const workId = initialState.active_work_id!

      upsertTaskSessionStateForWork(TEST_DIR, workId, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "task one",
        sessionId: "task-session-a",
      })

      const seededState = readBoulderState(TEST_DIR)!
      seededState.works![workId]!.task_sessions!["todo:1"]!.started_at = "2026-01-01T00:00:00.000Z"
      writeBoulderState(TEST_DIR, seededState)

      // when
      const updated = upsertTaskSessionStateForWork(TEST_DIR, workId, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "task one",
        sessionId: "task-session-b",
      })

      // then
      expect(updated).not.toBeNull()
      const taskSession = updated?.works?.[workId]?.task_sessions?.["todo:1"]
      expect(taskSession?.session_id).toBe("task-session-b")
      expect(taskSession?.started_at).toBe("2026-01-01T00:00:00.000Z")
    })
  })

  describe("task timer and completion helpers", () => {
    test("should keep started_at stable when starting timer repeatedly", () => {
      // given
      const initialState = createBoulderState(join(TEST_DIR, ".sisyphus/plans/plan-a.md"), "session-a")
      writeBoulderState(TEST_DIR, initialState)
      const workId = initialState.active_work_id!

      // when
      startTaskTimer(TEST_DIR, workId, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "task one",
        sessionId: "session-a",
        startedAt: "2026-01-01T00:00:00.000Z",
      })
      startTaskTimer(TEST_DIR, workId, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "task one",
        sessionId: "session-a",
        startedAt: "2026-01-02T00:00:00.000Z",
      })

      // then
      const taskSession = readBoulderState(TEST_DIR)?.works?.[workId]?.task_sessions?.["todo:1"]
      expect(taskSession?.started_at).toBe("2026-01-01T00:00:00.000Z")
      expect(taskSession?.status).toBe("running")
    })

    test("should compute elapsed_ms when ending task timer", () => {
      // given
      const initialState = createBoulderState(join(TEST_DIR, ".sisyphus/plans/plan-a.md"), "session-a")
      writeBoulderState(TEST_DIR, initialState)
      const workId = initialState.active_work_id!
      startTaskTimer(TEST_DIR, workId, {
        taskKey: "todo:1",
        taskLabel: "1",
        taskTitle: "task one",
        sessionId: "session-a",
        startedAt: "2026-01-01T00:00:00.000Z",
      })

      // when
      const endedState = endTaskTimer(TEST_DIR, workId, "todo:1", "2026-01-01T00:00:01.500Z")

      // then
      const taskSession = endedState?.works?.[workId]?.task_sessions?.["todo:1"]
      expect(taskSession?.ended_at).toBe("2026-01-01T00:00:01.500Z")
      expect(taskSession?.elapsed_ms).toBe(1500)
      expect(taskSession?.status).toBe("completed")
    })

    test("should complete one work and keep other work untouched", () => {
      // given
      const initialState = createBoulderState(join(TEST_DIR, ".sisyphus/plans/plan-a.md"), "session-a")
      writeBoulderState(TEST_DIR, initialState)
      const firstWorkId = initialState.active_work_id!
      const withSecond = addBoulderWork(TEST_DIR, {
        planPath: join(TEST_DIR, ".sisyphus/plans/plan-b.md"),
        sessionId: "session-b",
      })
      const secondWorkId = Object.keys(withSecond!.works!).find((workId) => workId !== firstWorkId)!

      // when
      const completedState = completeBoulder(TEST_DIR, firstWorkId, "2026-01-01T01:00:00.000Z")

      // then
      expect(completedState?.works?.[firstWorkId]?.status).toBe("completed")
      expect(completedState?.works?.[firstWorkId]?.ended_at).toBe("2026-01-01T01:00:00.000Z")
      expect(completedState?.works?.[firstWorkId]?.elapsed_ms).toBe(
        Date.parse("2026-01-01T01:00:00.000Z") - Date.parse(completedState!.works![firstWorkId]!.started_at),
      )
      expect(completedState?.works?.[secondWorkId]?.status).not.toBe("completed")
      expect(existsSync(join(SISYPHUS_DIR, "boulder.json"))).toBe(true)
    })

    test("should keep first completion timing when completeBoulder is called repeatedly", () => {
      // given
      const initialState = createBoulderState(
        join(TEST_DIR, ".sisyphus/plans/plan-idempotent.md"),
        "session-a",
      )
      writeBoulderState(TEST_DIR, initialState)
      const workId = initialState.active_work_id!

      // when
      const firstCompletedState = completeBoulder(TEST_DIR, workId, "2026-01-01T00:01:00Z")
      const secondCompletedState = completeBoulder(TEST_DIR, workId, "2026-01-01T01:00:00Z")

      // then
      expect(firstCompletedState?.works?.[workId]?.ended_at).toBe("2026-01-01T00:01:00Z")
      expect(secondCompletedState?.works?.[workId]?.ended_at).toBe("2026-01-01T00:01:00Z")
      expect(secondCompletedState?.works?.[workId]?.elapsed_ms).toBe(
        Date.parse("2026-01-01T00:01:00Z") - Date.parse(secondCompletedState!.works![workId]!.started_at),
      )
    })
  })

  describe("readCurrentTopLevelTask", () => {
    test("should return the first unchecked top-level task in TODOs", () => {
      // given - plan with nested and top-level unchecked tasks
      const planPath = join(TEST_DIR, "current-task-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Finished task
  - [ ] nested acceptance checkbox
- [ ] 2. Current task

## Final Verification Wave
- [ ] F1. Final review
`)

      // when
      const result = readCurrentTopLevelTask(planPath)

      // then
      expect(result).not.toBeNull()
      expect(result?.key).toBe("todo:2")
      expect(result?.title).toBe("Current task")
    })

    test("should fall back to final-wave task when implementation tasks are complete", () => {
      // given - plan with only final-wave work remaining
      const planPath = join(TEST_DIR, "final-wave-current-task-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Finished task

## Final Verification Wave
- [ ] F1. Final review
`)

      // when
      const result = readCurrentTopLevelTask(planPath)

      // then
      expect(result).not.toBeNull()
      expect(result?.key).toBe("final-wave:f1")
      expect(result?.title).toBe("Final review")
    })
  })

  describe("getPlanProgress", () => {
    test("should count only top-level tasks under TODOs and Final Verification Wave sections", () => {
      // given - plan with top-level tasks in tracked sections
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Task 1
- [x] 2. Task 2
- [ ] 3. Task 3
- [X] 4. Task 4

## Final Verification Wave
- [ ] F1. Final review
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(5)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(false)
    })

    test("should ignore nested Acceptance Criteria checkboxes under TODOs (issue #3066)", () => {
      // given - plan with 9 completed top-level tasks and unchecked nested acceptance criteria
      const planPath = join(TEST_DIR, "issue-3066-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Implement feature A

  **Acceptance Criteria**
  - [ ] criterion 1
  - [ ] criterion 2

- [x] 2. Implement feature B

  **Acceptance Criteria**
  - [ ] criterion 3
  - [ ] criterion 4

- [x] 3. Implement feature C
- [x] 4. Implement feature D
- [x] 5. Implement feature E
- [x] 6. Implement feature F
- [x] 7. Implement feature G
- [x] 8. Implement feature H
- [x] 9. Implement feature I

## Final Verification Wave
- [ ] F1. Final review
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(10)
      expect(progress.completed).toBe(9)
      expect(progress.isComplete).toBe(false)
    })

    test("should ignore checkboxes outside TODOs and Final Verification Wave sections", () => {
      // given - plan with checkboxes in Work Objectives, Success Criteria, and other sections
      const planPath = join(TEST_DIR, "ignore-other-sections-plan.md")
      writeFileSync(planPath, `# Plan

## Work Objectives

### Definition of Done
- [ ] Verifiable condition with command

## TODOs
- [x] 1. Real task one
- [ ] 2. Real task two

## Success Criteria

### Final Checklist
- [ ] All Must Have present
- [ ] All Must NOT Have absent
- [ ] All tests pass
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(1)
      expect(progress.isComplete).toBe(false)
    })

    test("should ignore indented checkboxes under top-level tasks", () => {
      // given - plan with indented unchecked nested checkboxes
      const planPath = join(TEST_DIR, "nested-indented-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. top-level completed task
  - [ ] nested unchecked task
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(1)
      expect(progress.completed).toBe(1)
      expect(progress.isComplete).toBe(true)
    })

    test("should require proper task label format in TODOs", () => {
      // given - plan with malformed labels (no numeric prefix)
      const planPath = join(TEST_DIR, "malformed-labels-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] no number prefix
- [x] 1. Valid numbered task
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(1)
      expect(progress.completed).toBe(1)
      expect(progress.isComplete).toBe(true)
    })

    test("should require F-prefix label format in Final Verification Wave", () => {
      // given - plan with malformed final-wave labels
      const planPath = join(TEST_DIR, "malformed-final-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Implementation done

## Final Verification Wave
- [ ] missing F-prefix
- [ ] F1. Proper final review
- [x] F2. Another final review
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(3)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(false)
    })

    test("should return isComplete true when all top-level tasks checked", () => {
      // given - all top-level tasks completed
      const planPath = join(TEST_DIR, "complete-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Task 1
- [X] 2. Task 2

## Final Verification Wave
- [x] F1. Final review
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(3)
      expect(progress.completed).toBe(3)
      expect(progress.isComplete).toBe(true)
    })

    test("should return isComplete false for empty plan", () => {
      // given - plan with no checkboxes
      const planPath = join(TEST_DIR, "empty-plan.md")
      writeFileSync(planPath, "# Plan\nNo tasks here")

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(0)
      expect(progress.isComplete).toBe(false)
    })

    test("should handle non-existent file", () => {
      // given - non-existent file
      // when
      const progress = getPlanProgress("/non/existent/file.md")
      // then
      expect(progress.total).toBe(0)
      expect(progress.completed).toBe(0)
      expect(progress.isComplete).toBe(false)
    })

    test("should support asterisk bullet top-level tasks", () => {
      // given - plan with asterisk bullet tasks
      const planPath = join(TEST_DIR, "asterisk-bullet-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
* [x] 1. Task using asterisk bullet
* [ ] 2. Another asterisk task
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(1)
      expect(progress.isComplete).toBe(false)
    })

    test("should count only top-level checkboxes for simple plans with nested tasks", () => {
      // given
      const planPath = join(TEST_DIR, "simple-nested-plan.md")
      writeFileSync(planPath, `# Plan

- [ ] Top-level task 1
  - [x] Nested task ignored
- [x] Top-level task 2
    * [ ] Another nested task ignored
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(1)
      expect(progress.isComplete).toBe(false)
    })

    test("should treat final-wave-only plans as structured mode", () => {
      // given
      const planPath = join(TEST_DIR, "final-wave-only-plan.md")
      writeFileSync(planPath, `# Plan

## Final Verification Wave
- [ ] F1. Top-level final review
  - [x] Nested verification detail ignored
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(1)
      expect(progress.completed).toBe(0)
      expect(progress.isComplete).toBe(false)
    })

    test("should ignore mixed indentation levels in simple plans", () => {
      // given
      const planPath = join(TEST_DIR, "simple-mixed-indentation-plan.md")
      writeFileSync(planPath, `# Plan

* [x] Top-level star task
 - [ ] Indented task ignored
	- [x] Tab-indented task ignored
- [ ] Top-level dash task
`)

      // when
      const progress = getPlanProgress(planPath)

      // then
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(1)
      expect(progress.isComplete).toBe(false)
    })
  })

  describe("getPlanName", () => {
    test("should extract plan name from path", () => {
      // given
      const path = "/home/user/.sisyphus/plans/project/my-feature.md"
      // when
      const name = getPlanName(path)
      // then
      expect(name).toBe("my-feature")
    })
  })

  describe("createBoulderState", () => {
    test("should create state with correct fields", () => {
      // given
      const planPath = "/path/to/auth-refactor.md"
      const sessionId = "ses-abc123"

      // when
      const state = createBoulderState(planPath, sessionId)

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
      const agent = "atlas"

      //#when - createBoulderState is called with agent
      const state = createBoulderState(planPath, sessionId, agent)

      //#then - state should include the agent field
      expect(state.agent).toBe("atlas")
      expect(state.active_plan).toBe(planPath)
      expect(state.session_ids).toEqual([sessionId])
      expect(state.plan_name).toBe("feature")
    })

    test("should mark the initial session origin as direct", () => {
      // given
      const planPath = "/path/to/feature.md"
      const sessionId = "ses-origin"

      // when
      const state = createBoulderState(planPath, sessionId)

      // then
      expect(state.session_origins).toEqual({ [sessionId]: "direct" })
    })

    test("should allow agent to be undefined", () => {
      //#given - plan path and session id without agent
      const planPath = "/path/to/legacy.md"
      const sessionId = "ses-legacy"

      //#when - createBoulderState is called without agent
      const state = createBoulderState(planPath, sessionId)

      //#then - state should not have agent field (backward compatible)
      expect(state.agent).toBeUndefined()
    })
  })

  describe("resolveBoulderPlanPath", () => {
    test("should prefer the mirrored worktree plan when it exists", () => {
      // given
      const planPath = join(TEST_DIR, ".sisyphus", "plans", "worktree-plan.md")
      const worktreeDir = join(tmpdir(), `boulder-state-worktree-${Date.now()}`)
      const worktreePlanPath = join(worktreeDir, ".sisyphus", "plans", "worktree-plan.md")
      mkdirSync(dirname(planPath), { recursive: true })
      mkdirSync(dirname(worktreePlanPath), { recursive: true })
      writeFileSync(planPath, "# Plan\n- [ ] Main repo task\n")
      writeFileSync(worktreePlanPath, "# Plan\n- [x] Worktree task\n")

      try {
        // when
        const resolvedPath = resolveBoulderPlanPath(TEST_DIR, {
          active_plan: planPath,
          worktree_path: worktreeDir,
        })

        // then
        expect(resolvedPath).toBe(worktreePlanPath)
      } finally {
        rmSync(worktreeDir, { recursive: true, force: true })
      }
    })

    test("should fall back to the tracked plan when the mirrored worktree plan is missing", () => {
      // given
      const planPath = join(TEST_DIR, ".sisyphus", "plans", "fallback-plan.md")
      mkdirSync(dirname(planPath), { recursive: true })
      writeFileSync(planPath, "# Plan\n- [ ] Main repo task\n")

      // when
      const resolvedPath = resolveBoulderPlanPath(TEST_DIR, {
        active_plan: planPath,
        worktree_path: join(tmpdir(), `missing-worktree-${Date.now()}`),
      })

      // then
      expect(resolvedPath).toBe(planPath)
    })
  })
})
