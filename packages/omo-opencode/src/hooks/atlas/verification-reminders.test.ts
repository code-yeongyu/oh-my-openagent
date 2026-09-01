import { describe, expect, test } from "bun:test"
import {
  buildAdvanceDirective,
  buildCompletionGate,
  buildFinalWaveApprovalReminder,
  buildMissingVerdictEscalation,
  buildOrchestratorReminder,
  buildRejectedVerdictEscalation,
  buildStandaloneVerificationReminder,
} from "./verification-reminders"

// Fixed sentinels: unique per slot, deterministic across runs, and absent
// from every builder template, so containment proves interpolation.
const PLAN_NAME = "plan-sentinel-9f2c"
const SESSION_ID = "ses_sentinel_5e17"
const TASK_LABEL = "task-sentinel-3b81"

describe("verification reminder builders", () => {
  test("completion gate propagates the plan and continuation session", () => {
    const result = buildCompletionGate(PLAN_NAME, SESSION_ID)

    expect(result).toContain(PLAN_NAME)
    expect(result).toContain(SESSION_ID)
  })

  test("orchestrator reminder propagates plan, session, and progress values", () => {
    const progress = { total: 11, completed: 4 }

    const result = buildOrchestratorReminder(PLAN_NAME, progress, SESSION_ID, false)

    expect(result).toContain(PLAN_NAME)
    expect(result).toContain(SESSION_ID)
    expect(result).toContain(`${progress.completed}/${progress.total}`)
    expect(result).toContain(String(progress.total - progress.completed))
  })

  test("final-wave reminder propagates plan, session, and progress values", () => {
    const progress = { total: 9, completed: 5 }

    const result = buildFinalWaveApprovalReminder(PLAN_NAME, progress, SESSION_ID)

    expect(result).toContain(PLAN_NAME)
    expect(result).toContain(SESSION_ID)
    expect(result).toContain(`${progress.completed}/${progress.total}`)
    expect(result).toContain(String(progress.total - progress.completed))
  })

  test("standalone reminder propagates the continuation session", () => {
    expect(buildStandaloneVerificationReminder(SESSION_ID)).toContain(SESSION_ID)
  })

  test("missing and rejected verdict reminders propagate plan, task, and session values", () => {
    for (const result of [
      buildMissingVerdictEscalation(PLAN_NAME, TASK_LABEL, SESSION_ID),
      buildRejectedVerdictEscalation(PLAN_NAME, TASK_LABEL, SESSION_ID),
    ]) {
      expect(result).toContain(PLAN_NAME)
      expect(result).toContain(TASK_LABEL)
      expect(result).toContain(SESSION_ID)
    }
  })

  test("advance directive propagates the active plan", () => {
    expect(buildAdvanceDirective(PLAN_NAME)).toContain(PLAN_NAME)
  })
})
