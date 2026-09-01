import { describe, expect, test } from "bun:test"
import type {
  BoulderSessionOrigin,
  BoulderState,
  BoulderTaskStatus,
  BoulderWorkResumeOption,
  BoulderWorkState,
  BoulderWorkStatus,
  PlanProgress,
  TaskSessionState,
} from "./types"

describe("boulder-state types", () => {
  test("keeps legacy BoulderState assignable while allowing v2 fields", () => {
    // given
    const legacyState: BoulderState = {
      active_plan: "/tmp/plan.md",
      started_at: "2026-01-01T00:00:00.000Z",
      session_ids: ["ses_1"],
      plan_name: "plan",
    }

    // when
    const hasLegacyShape = legacyState.active_plan.length > 0

    // then
    expect(hasLegacyShape).toBe(true)
  })

  test("supports multi-work and timer fields", () => {
    // given
    const taskStatus: BoulderTaskStatus = "running"
    const workStatus: BoulderWorkStatus = "active"
    const origin: BoulderSessionOrigin = "direct"

    const taskSession: TaskSessionState = {
      task_key: "todo:1",
      task_label: "1",
      task_title: "Do work",
      session_id: "ses_task",
      started_at: "2026-01-01T00:00:00.000Z",
      ended_at: "2026-01-01T00:00:01.000Z",
      elapsed_ms: 1000,
      status: taskStatus,
      updated_at: "2026-01-01T00:00:01.000Z",
    }

    const work: BoulderWorkState = {
      work_id: "plan-abc12345",
      active_plan: "/tmp/plan.md",
      plan_name: "plan",
      status: workStatus,
      started_at: "2026-01-01T00:00:00.000Z",
      session_ids: ["ses_1"],
      session_origins: { ses_1: origin },
      task_sessions: { "todo:1": taskSession },
    }

    const progress: PlanProgress = { total: 2, completed: 1, isComplete: false }
    const resumeOption: BoulderWorkResumeOption = {
      work_id: work.work_id,
      plan_name: work.plan_name,
      active_plan: work.active_plan,
      status: "paused",
      started_at: work.started_at,
      updated_at: "2026-01-01T00:00:02.000Z",
      session_count: 1,
      progress,
      is_current_mirror: false,
    }

    // when
    const combined = { taskSession, work, resumeOption }

    // then
    expect(combined.resumeOption.progress.total).toBe(2)
  })
})
