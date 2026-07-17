import { describe, expect, it } from "bun:test"
import {
  buildOrchestratorReminder,
  buildCompletionGate,
  buildMissingVerdictEscalation,
  buildAdvanceDirective,
} from "./verification-reminders"

// Test helpers for given/when/then pattern
const given = describe
const when = describe
const then = it

describe("buildCompletionGate", () => {
  given("a plan name and session id", () => {
    const planName = "test-plan"
    const sessionId = "test-session-123"

    when("buildCompletionGate is called", () => {
      const gate = buildCompletionGate(planName, sessionId)

      then("completion gate text is present", () => {
        expect(gate).toContain("COMPLETION GATE")
      })

      then("gate appears before verification phase text", () => {
        const gateIndex = gate.indexOf("COMPLETION GATE")
        const verificationIndex = gate.indexOf("VERIFICATION_REMINDER")
        expect(gateIndex).toBeLessThan(verificationIndex)
      })

      then("gate interpolates the plan name path", () => {
        expect(gate).toContain(planName)
        expect(gate).toContain(`.omo/plans/${planName}.md`)
      })
    })
  })
})

describe("buildOrchestratorReminder", () => {
  given("progress with completed tasks", () => {
    const planName = "my-test-plan"
    const sessionId = "session-abc"
    const progress = { total: 10, completed: 3 }

    when("buildOrchestratorReminder is called with autoCommit true", () => {
      const reminder = buildOrchestratorReminder(planName, progress, sessionId, true)

      then("completion gate appears before verification reminder", () => {
        const gateIndex = reminder.indexOf("COMPLETION GATE")
        const verificationIndex = reminder.indexOf("VERIFICATION_REMINDER")
        expect(gateIndex).toBeGreaterThanOrEqual(0)
        expect(gateIndex).toBeLessThan(verificationIndex)
      })
    })

    when("buildOrchestratorReminder is called with autoCommit false", () => {
      const reminder = buildOrchestratorReminder(planName, progress, sessionId, false)

      then("completion gate appears before verification reminder", () => {
        const gateIndex = reminder.indexOf("COMPLETION GATE")
        const verificationIndex = reminder.indexOf("VERIFICATION_REMINDER")
        expect(gateIndex).toBeGreaterThanOrEqual(0)
        expect(gateIndex).toBeLessThan(verificationIndex)
      })
    })
  })
})

describe("buildMissingVerdictEscalation", () => {
  given("a plan name, task label, and session id", () => {
    const planName = "atlas-loop-compaction-bg-fixes"
    const taskLabel = "T13: add builders"
    const sessionId = "ses_review_abc"

    when("buildMissingVerdictEscalation is called", () => {
      const message = buildMissingVerdictEscalation(planName, taskLabel, sessionId)

      then("output names the task label", () => {
        expect(message).toContain(taskLabel)
      })

      then("output names the plan", () => {
        expect(message).toContain(planName)
      })

      then("output includes a reuse hint for the session", () => {
        expect(message).toContain(sessionId)
      })

      then("output includes the machine-parsed verdict sentinels", () => {
        expect(message).toContain("VERDICT: APPROVE")
        expect(message).toContain("VERDICT: REJECT")
      })
    })
  })
})

describe("buildAdvanceDirective", () => {
  given("a plan name", () => {
    const planName = "atlas-loop-compaction-bg-fixes"

    when("buildAdvanceDirective is called", () => {
      const directive = buildAdvanceDirective(planName)

      then("output names the plan file path", () => {
        expect(directive).toContain(`.omo/plans/${planName}.md`)
      })
    })
  })
})
