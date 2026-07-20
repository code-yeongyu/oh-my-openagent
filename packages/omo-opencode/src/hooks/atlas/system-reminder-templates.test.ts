import { describe, it, expect } from "bun:test"
import {
  BOULDER_COMPLETE_PROMPT,
  BOULDER_CONTINUATION_PROMPT,
  SINGLE_TASK_DIRECTIVE,
  VERIFICATION_REMINDER,
  VERIFICATION_REMINDER_GEMINI,
} from "./system-reminder-templates"

function requireContinuationRulesSection(): string {
  const rulesSection = BOULDER_CONTINUATION_PROMPT.split("RULES:")[1]
  expect(rulesSection).toBeDefined()
  if (rulesSection === undefined) {
    throw new Error("Expected boulder continuation rules section")
  }
  return rulesSection
}

function requireFirstRule(rulesSection: string): string {
  const firstRule = rulesSection.split("\n")[1]
  expect(firstRule).toBeDefined()
  if (firstRule === undefined) {
    throw new Error("Expected first boulder continuation rule")
  }
  return firstRule.trim()
}

function requireMatchIndex(match: RegExpMatchArray | null, label: string): number {
  expect(match).not.toBeNull()
  if (match === null || match.index === undefined) {
    throw new Error(`Expected ${label} match index`)
  }
  return match.index
}

describe("BOULDER_CONTINUATION_PROMPT", () => {
  describe("checkbox-first priority rules", () => {
    it("first rule after RULES: mentions both reading the plan AND marking a still-unchecked completed task", () => {
      const rulesSection = requireContinuationRulesSection()
      const firstRule = requireFirstRule(rulesSection)

      expect(firstRule).toContain("Read the plan")
      expect(firstRule).toContain("mark")
      expect(firstRule).toContain("completed")
    })

    it("first rule includes IMMEDIATELY keyword", () => {
      const rulesSection = requireContinuationRulesSection()
      const firstRule = requireFirstRule(rulesSection)

      expect(firstRule).toContain("IMMEDIATELY")
    })

    it("approval-gate stop guidance appears before conditional proceed guidance", () => {
      const rulesSection = requireContinuationRulesSection()

      const stopMatch = rulesSection.match(/waiting for user input/i)
      const proceedMatch = rulesSection.match(/Otherwise, proceed without asking for permission/)

      const stopPosition = requireMatchIndex(stopMatch, "approval-gate stop guidance")
      const proceedPosition = requireMatchIndex(proceedMatch, "conditional proceed guidance")

      expect(stopPosition).toBeLessThan(proceedPosition)
      expect(rulesSection).toContain("Do not proceed past approval gates")
    })
  })
})

describe("VERIFICATION_REMINDER", () => {
  it("contains node_modules exclusion pathspec in git diff command", () => {
    expect(VERIFICATION_REMINDER).toContain(":!node_modules")
  })
})

describe("BOULDER_COMPLETE_PROMPT", () => {
  it("contains the required placeholders", () => {
    expect(BOULDER_COMPLETE_PROMPT).toContain("{PLAN_NAME}")
    expect(BOULDER_COMPLETE_PROMPT).toContain("{ELAPSED_HUMAN}")
    expect(BOULDER_COMPLETE_PROMPT).toContain("{TASK_BREAKDOWN}")
  })
})

describe("VERIFICATION_REMINDER_GEMINI", () => {
  it("contains node_modules exclusion pathspec in git diff command", () => {
    expect(VERIFICATION_REMINDER_GEMINI).toContain(":!node_modules")
  })
})

describe("SINGLE_TASK_DIRECTIVE", () => {
  it("does not contain refusal language", () => {
    // given
    const lowerCaseDirective = SINGLE_TASK_DIRECTIVE.toLowerCase()

    // when / then
    expect(lowerCaseDirective).not.toContain("refuse")
    expect(SINGLE_TASK_DIRECTIVE).not.toContain("I refuse")
  })

  it("contains systematic execution guidance", () => {
    expect(SINGLE_TASK_DIRECTIVE).toContain("EXECUTION PROTOCOL")
    expect(SINGLE_TASK_DIRECTIVE).toContain("VERIFICATION IS MANDATORY")
  })
})
