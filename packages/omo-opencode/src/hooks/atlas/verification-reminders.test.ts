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

      then("gate includes Edit instructions", () => {
        expect(gate.toLowerCase()).toContain("edit")
      })

      then("gate includes Read instructions", () => {
        expect(gate.toLowerCase()).toContain("read")
      })

      then("old STEP 7 MARK COMPLETION text is absent", () => {
        expect(gate).not.toContain("STEP 7")
        expect(gate).not.toContain("MARK COMPLETION IN PLAN FILE")
      })

      then("step numbering remains consecutive after removal", () => {
        const stepMatches = gate.match(/STEP \d+:/g) ?? []
        if (stepMatches.length > 1) {
          const numbers = stepMatches.map((s: string) => parseInt(s.match(/\d+/)?.[0] ?? "0"))
          for (let i = 1; i < numbers.length; i++) {
            expect(numbers[i]).toBe(numbers[i - 1] + 1)
          }
        }
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

      then("old STEP 7 MARK COMPLETION IN PLAN FILE text is absent", () => {
        expect(reminder).not.toContain("STEP 7: MARK COMPLETION IN PLAN FILE")
      })

      then("completion gate appears before verification reminder", () => {
        const gateIndex = reminder.indexOf("COMPLETION GATE")
        const verificationIndex = reminder.indexOf("VERIFICATION_REMINDER")
        expect(gateIndex).toBeGreaterThanOrEqual(0)
        expect(gateIndex).toBeLessThan(verificationIndex)
      })
    })

    when("buildOrchestratorReminder is called with autoCommit false", () => {
      const reminder = buildOrchestratorReminder(planName, progress, sessionId, false)

      then("old STEP 7 MARK COMPLETION IN PLAN FILE text is absent", () => {
        expect(reminder).not.toContain("STEP 7: MARK COMPLETION IN PLAN FILE")
      })

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

      then("output says the boulder is paused", () => {
        expect(message.toLowerCase()).toContain("paused")
      })

      then("output includes a reuse hint for the session", () => {
        expect(message).toContain(sessionId)
      })

      then("output asks to confirm or re-run the review", () => {
        expect(message.toLowerCase()).toContain("re-run the review")
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

      then("output names the next unchecked task", () => {
        expect(directive.toLowerCase()).toContain("next unchecked")
      })

      then("output names the plan file path", () => {
        expect(directive).toContain(`.omo/plans/${planName}.md`)
      })

      then("output says do NOT re-verify finished work", () => {
        expect(directive.toLowerCase()).toContain("do not re-verify")
      })

      then("output is short", () => {
        expect(directive.length).toBeLessThan(600)
      })

      then("output does NOT contain 4-phase PROBABLY LYING content", () => {
        expect(directive).not.toContain("PROBABLY LYING")
        expect(directive).not.toContain("PHASE 1")
        expect(directive).not.toContain("PHASE 2")
        expect(directive).not.toContain("PHASE 3")
        expect(directive).not.toContain("PHASE 4")
        expect(directive).not.toContain("VERIFICATION_REMINDER")
      })
    })
  })
})
