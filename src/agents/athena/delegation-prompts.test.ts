import { describe, expect, test } from "bun:test"
import type { SynthesizedFinding } from "./synthesis-types"
import { buildAtlasDelegationPrompt, buildPrometheusDelegationPrompt } from "./delegation-prompts"

function createConfirmedFindings(): SynthesizedFinding[] {
  return [
    {
      summary: "Guard missing council config in startup",
      details: "Athena path can proceed with undefined council members in some flows.",
      agreementLevel: "unanimous",
      reportedBy: ["OpenAI", "Claude", "Gemini"],
      assessment: {
        agrees: true,
        rationale: "Directly observed from startup and config fallback paths.",
      },
      isFalsePositiveRisk: false,
    },
    {
      summary: "Potential retry thrash in background runner",
      details: "Repeated failures can cascade retry windows under high load.",
      agreementLevel: "minority",
      reportedBy: ["Claude"],
      assessment: {
        agrees: true,
        rationale: "Worth addressing to lower operational risk.",
      },
      isFalsePositiveRisk: false,
    },
  ]
}

describe("buildAtlasDelegationPrompt", () => {
  //#given confirmed findings and an original question
  //#when the Atlas delegation prompt is built
  //#then it includes both findings and the original question context
  test("includes confirmed findings summaries and original question", () => {
    const findings = createConfirmedFindings()
    const question = "Which issues should we fix first in Athena integration?"

    const prompt = buildAtlasDelegationPrompt(findings, question)

    expect(prompt).toContain("Original question")
    expect(prompt).toContain(question)
    expect(prompt).toContain("Guard missing council config in startup")
    expect(prompt).toContain("Potential retry thrash in background runner")
  })

  //#given confirmed findings
  //#when Atlas prompt is generated
  //#then it explicitly asks Atlas to fix those specific issues
  test("instructs Atlas to implement direct fixes", () => {
    const prompt = buildAtlasDelegationPrompt(createConfirmedFindings(), "Fix Athena reliability issues")

    expect(prompt).toContain("Fix these confirmed issues directly")
    expect(prompt).toContain("Implement code changes")
    expect(prompt).toContain("prioritize by agreement level")
  })

  //#given a single confirmed finding
  //#when Atlas prompt is generated
  //#then prompt still renders correctly for edge case input
  test("handles a single finding edge case", () => {
    const [singleFinding] = createConfirmedFindings()

    const prompt = buildAtlasDelegationPrompt([singleFinding], "Fix this one issue")

    expect(prompt).toContain("1. Guard missing council config in startup")
    expect(prompt).toContain("Agreement level: unanimous")
  })
})

describe("buildPrometheusDelegationPrompt", () => {
  //#given confirmed findings and an original question
  //#when the Prometheus delegation prompt is built
  //#then it includes both findings and the original question context
  test("includes confirmed findings summaries and original question", () => {
    const findings = createConfirmedFindings()
    const question = "How should we sequence Athena integration hardening work?"

    const prompt = buildPrometheusDelegationPrompt(findings, question)

    expect(prompt).toContain("Original question")
    expect(prompt).toContain(question)
    expect(prompt).toContain("Guard missing council config in startup")
    expect(prompt).toContain("Potential retry thrash in background runner")
  })

  //#given confirmed findings
  //#when Prometheus prompt is generated
  //#then it explicitly asks for phased planning and prioritization
  test("instructs Prometheus to create an execution plan", () => {
    const prompt = buildPrometheusDelegationPrompt(createConfirmedFindings(), "Plan Athena stabilization")

    expect(prompt).toContain("Create an execution plan")
    expect(prompt).toContain("phased implementation plan")
    expect(prompt).toContain("prioritize by agreement level and impact")
  })

  //#given a single confirmed finding
  //#when Prometheus prompt is generated
  //#then prompt still renders correctly for edge case input
  test("handles a single finding edge case", () => {
    const [singleFinding] = createConfirmedFindings()

    const prompt = buildPrometheusDelegationPrompt([singleFinding], "Plan this one issue")

    expect(prompt).toContain("1. Guard missing council config in startup")
    expect(prompt).toContain("Agreement level: unanimous")
  })

  //#given findings at multiple agreement levels
  //#when either delegation prompt is generated
  //#then each finding includes agreement level context
  test("includes agreement level context for each finding in both prompts", () => {
    const findings = createConfirmedFindings()

    const atlasPrompt = buildAtlasDelegationPrompt(findings, "Atlas context")
    const prometheusPrompt = buildPrometheusDelegationPrompt(findings, "Prometheus context")

    expect(atlasPrompt).toContain("Agreement level: unanimous")
    expect(atlasPrompt).toContain("Agreement level: minority")
    expect(prometheusPrompt).toContain("Agreement level: unanimous")
    expect(prometheusPrompt).toContain("Agreement level: minority")
  })
})
